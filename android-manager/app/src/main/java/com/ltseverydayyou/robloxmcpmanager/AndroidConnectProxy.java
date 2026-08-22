package com.ltseverydayyou.robloxmcpmanager;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Loopback-only HTTP CONNECT proxy that delegates DNS resolution to Android.
 *
 * The official Linux ARM64 tunnel-client can see an unusable localhost DNS
 * entry inside Android's app process namespace. Connecting to this proxy never
 * requires Go DNS, while the Java socket uses Android's network resolver. TLS
 * remains end-to-end between tunnel-client and OpenAI.
 */
final class AndroidConnectProxy implements AutoCloseable {
    private static final int MAX_HEADERS = 8_192;
    private static final Set<String> ALLOWED_HOSTS;

    static {
        Set<String> hosts = new HashSet<>();
        hosts.add("api.openai.com");
        hosts.add("mtls.api.openai.com");
        ALLOWED_HOSTS = Collections.unmodifiableSet(hosts);
    }

    private final ServerSocket listener;
    private final Set<Socket> openSockets = Collections.synchronizedSet(new HashSet<>());
    private final Thread acceptThread;
    private volatile boolean running = true;

    private AndroidConnectProxy(ServerSocket listener) {
        this.listener = listener;
        acceptThread = new Thread(this::acceptLoop, "openai-control-plane-proxy");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    static AndroidConnectProxy start() throws IOException {
        ServerSocket listener = new ServerSocket();
        listener.setReuseAddress(true);
        listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 8);
        return new AndroidConnectProxy(listener);
    }

    String url() {
        return "http://127.0.0.1:" + listener.getLocalPort();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = listener.accept();
                openSockets.add(client);
                Thread handler = new Thread(() -> handle(client), "openai-connect-proxy-client");
                handler.setDaemon(true);
                handler.start();
            } catch (IOException error) {
                if (running) Log.e("RobloxMcpTunnel", "Control-plane proxy accept failed", error);
            }
        }
    }

    private void handle(Socket client) {
        Socket upstream = null;
        try {
            client.setSoTimeout(5_000);
            String request = readHeaders(client.getInputStream());
            String firstLine = request.substring(0, request.indexOf("\r\n"));
            String[] parts = firstLine.split(" ");
            if (parts.length != 3 || !"CONNECT".equals(parts[0])) {
                reject(client, 405, "CONNECT required");
                return;
            }

            int colon = parts[1].lastIndexOf(':');
            if (colon < 1) {
                reject(client, 400, "Invalid CONNECT target");
                return;
            }
            String host = parts[1].substring(0, colon).toLowerCase(Locale.US);
            int port;
            try {
                port = Integer.parseInt(parts[1].substring(colon + 1));
            } catch (NumberFormatException error) {
                reject(client, 400, "Invalid CONNECT port");
                return;
            }
            if (port != 443 || !ALLOWED_HOSTS.contains(host)) {
                reject(client, 403, "CONNECT target is not allowed");
                return;
            }

            upstream = connectWithAndroidDns(host, port);
            upstream.setSoTimeout(0);
            client.setSoTimeout(0);
            client.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n"
                .getBytes(StandardCharsets.US_ASCII));
            client.getOutputStream().flush();

            Socket finalUpstream = upstream;
            Thread responsePump = new Thread(
                () -> copyAndShutdown(finalUpstream, client),
                "openai-connect-proxy-response"
            );
            responsePump.setDaemon(true);
            responsePump.start();
            copy(client.getInputStream(), upstream.getOutputStream());
            try {
                upstream.shutdownOutput();
            } catch (IOException ignored) {
                // The peer may have already closed the connection.
            }
        } catch (Exception error) {
            if (running) Log.w("RobloxMcpTunnel", "Control-plane proxy connection ended: " + error.getMessage());
        } finally {
            closeSocket(client);
            closeSocket(upstream);
        }
    }

    private Socket connectWithAndroidDns(String host, int port) throws IOException {
        IOException lastError = null;
        for (InetAddress address : InetAddress.getAllByName(host)) {
            Socket candidate = new Socket();
            openSockets.add(candidate);
            try {
                candidate.connect(new InetSocketAddress(address, port), 10_000);
                return candidate;
            } catch (IOException error) {
                lastError = error;
                closeSocket(candidate);
            }
        }
        throw lastError == null ? new IOException("Android DNS returned no addresses for " + host) : lastError;
    }

    private static String readHeaders(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int matched = 0;
        while (bytes.size() < MAX_HEADERS) {
            int value = input.read();
            if (value < 0) throw new IOException("Proxy client closed before CONNECT headers completed");
            bytes.write(value);
            if ((matched == 0 || matched == 2) && value == '\r') matched++;
            else if ((matched == 1 || matched == 3) && value == '\n') matched++;
            else matched = value == '\r' ? 1 : 0;
            if (matched == 4) return bytes.toString(StandardCharsets.US_ASCII.name());
        }
        throw new IOException("CONNECT headers exceeded " + MAX_HEADERS + " bytes");
    }

    private static void reject(Socket client, int code, String reason) throws IOException {
        byte[] body = reason.getBytes(StandardCharsets.UTF_8);
        OutputStream output = client.getOutputStream();
        output.write(("HTTP/1.1 " + code + " " + reason + "\r\nConnection: close\r\nContent-Length: "
            + body.length + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
            .getBytes(StandardCharsets.US_ASCII));
        output.write(body);
        output.flush();
    }

    private static void copyAndShutdown(Socket source, Socket destination) {
        try {
            copy(source.getInputStream(), destination.getOutputStream());
            destination.shutdownOutput();
        } catch (IOException ignored) {
            // Closing either side is the normal end of a CONNECT stream.
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16_384];
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (count == 0) continue;
            output.write(buffer, 0, count);
            output.flush();
        }
    }

    private void closeSocket(Socket socket) {
        if (socket == null) return;
        openSockets.remove(socket);
        try {
            socket.close();
        } catch (IOException ignored) {
            // Already closed.
        }
    }

    @Override public void close() {
        running = false;
        try {
            listener.close();
        } catch (IOException ignored) {
            // Already closed.
        }
        for (Socket socket : new ArrayList<>(openSockets)) closeSocket(socket);
    }
}
