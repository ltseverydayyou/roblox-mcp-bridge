package com.ltseverydayyou.robloxmcpmanager;

import android.content.Context;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.X509Certificate;

import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import android.util.Base64;

/** Exports Android's current trusted CAs for the embedded Go/Linux client. */
final class AndroidTrustBundle {
    private static final String FILE_NAME = "android-system-ca-bundle.pem";

    static final class Result {
        final File file;
        final int certificateCount;

        Result(File file, int certificateCount) {
            this.file = file;
            this.certificateCount = certificateCount;
        }
    }

    private AndroidTrustBundle() {}

    static Result write(Context context) throws Exception {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        );
        factory.init((KeyStore) null);

        X509TrustManager trustManager = null;
        for (TrustManager candidate : factory.getTrustManagers()) {
            if (candidate instanceof X509TrustManager) {
                trustManager = (X509TrustManager) candidate;
                break;
            }
        }
        if (trustManager == null) {
            throw new IllegalStateException("Android did not provide an X509 system trust manager.");
        }

        X509Certificate[] certificates = trustManager.getAcceptedIssuers();
        if (certificates.length == 0) {
            throw new IllegalStateException("Android's system trust manager returned no CA certificates.");
        }

        File bundle = new File(context.getNoBackupFilesDir(), FILE_NAME);
        try (FileOutputStream stream = new FileOutputStream(bundle, false);
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(stream, StandardCharsets.US_ASCII))) {
            for (X509Certificate certificate : certificates) {
                writer.write("-----BEGIN CERTIFICATE-----\n");
                String encoded = Base64.encodeToString(certificate.getEncoded(), Base64.NO_WRAP);
                for (int offset = 0; offset < encoded.length(); offset += 64) {
                    writer.write(encoded, offset, Math.min(64, encoded.length() - offset));
                    writer.write('\n');
                }
                writer.write("-----END CERTIFICATE-----\n");
            }
            writer.flush();
            stream.getFD().sync();
        }
        return new Result(bundle, certificates.length);
    }
}
