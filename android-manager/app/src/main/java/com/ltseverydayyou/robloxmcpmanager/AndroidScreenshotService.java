package com.ltseverydayyou.robloxmcpmanager;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityService.ScreenshotResult;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class AndroidScreenshotService extends AccessibilityService {
    private static final String TAG = "RobloxMcpScreenshot";
    private static final int PORT = 17654;
    private static final int JPEG_QUALITY = 70;
    private volatile boolean running;
    private ServerSocket serverSocket;

    @Override public void onServiceConnected() {
        super.onServiceConnected();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.e(TAG, "Screenshot capture requires Android 11 or newer");
            return;
        }
        running = true;
        Thread serverThread = new Thread(this::runServer, "mcp-screenshot-server");
        serverThread.setDaemon(true);
        serverThread.start();
    }

    @Override public void onDestroy() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() {}

    private void runServer() {
        try {
            serverSocket = new ServerSocket(PORT, 4, InetAddress.getByName("127.0.0.1"));
            while (running) {
                try (Socket socket = serverSocket.accept()) {
                    socket.setSoTimeout(12000);
                    handle(socket);
                } catch (Exception error) {
                    if (running) Log.w(TAG, "Screenshot request failed", error);
                }
            }
        } catch (Exception error) {
            if (running) Log.e(TAG, "Could not start screenshot server", error);
        }
    }

    private void handle(Socket socket) throws Exception {
        byte[] requestBytes = new byte[4096];
        int count = socket.getInputStream().read(requestBytes);
        String request = count > 0 ? new String(requestBytes, 0, count, StandardCharsets.US_ASCII) : "";
        int maxWidth = parseMaxWidth(request);
        JSONObject body = capture(maxWidth);
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        OutputStream out = socket.getOutputStream();
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + payload.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(payload);
        out.flush();
    }

    private int parseMaxWidth(String request) {
        int fallback = 1280;
        try {
            int start = request.indexOf("maxWidth=");
            if (start < 0) return fallback;
            start += "maxWidth=".length();
            int end = start;
            while (end < request.length() && Character.isDigit(request.charAt(end))) end++;
            int value = Integer.parseInt(request.substring(start, end));
            return Math.max(320, Math.min(value, 3840));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private JSONObject capture(int maxWidth) throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return new JSONObject().put("error", "Android screenshot capture requires Android 11 or newer.");
        }

        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Bitmap> bitmapRef = new AtomicReference<>();
        AtomicReference<String> errorRef = new AtomicReference<>();

        takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
            @Override public void onSuccess(ScreenshotResult screenshot) {
                HardwareBuffer buffer = screenshot.getHardwareBuffer();
                try {
                    ColorSpace colorSpace = screenshot.getColorSpace();
                    Bitmap hardware = Bitmap.wrapHardwareBuffer(buffer, colorSpace);
                    if (hardware == null) {
                        errorRef.set("Android returned an empty screenshot buffer.");
                    } else {
                        bitmapRef.set(hardware.copy(Bitmap.Config.ARGB_8888, false));
                    }
                } catch (Throwable error) {
                    errorRef.set(error.getMessage() == null ? error.toString() : error.getMessage());
                } finally {
                    try { buffer.close(); } catch (Exception ignored) {}
                    latch.countDown();
                }
            }

            @Override public void onFailure(int errorCode) {
                errorRef.set("Android takeScreenshot failed with error code " + errorCode + ".");
                latch.countDown();
            }
        });

        if (!latch.await(10, TimeUnit.SECONDS)) {
            return new JSONObject().put("error", "Android screenshot capture timed out.");
        }
        if (errorRef.get() != null) {
            return new JSONObject().put("error", errorRef.get());
        }

        Bitmap bitmap = bitmapRef.get();
        if (bitmap == null) return new JSONObject().put("error", "Android did not return a screenshot.");
        Bitmap output = bitmap;
        try {
            if (bitmap.getWidth() > maxWidth) {
                int height = Math.max(1, Math.round(bitmap.getHeight() * (maxWidth / (float) bitmap.getWidth())));
                output = Bitmap.createScaledBitmap(bitmap, maxWidth, height, true);
            }
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            if (!output.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)) {
                return new JSONObject().put("error", "Could not encode Android screenshot.");
            }
            return new JSONObject()
                .put("imageBase64", Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
                .put("mimeType", "image/jpeg");
        } finally {
            if (output != bitmap) output.recycle();
            bitmap.recycle();
        }
    }
}
