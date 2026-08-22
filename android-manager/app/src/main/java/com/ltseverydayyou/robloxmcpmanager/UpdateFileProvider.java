package com.ltseverydayyou.robloxmcpmanager;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

public final class UpdateFileProvider extends ContentProvider {
    static final String FILE_NAME = "pending-update.apk";

    static File updateDirectory(Context context) {
        return new File(context.getCacheDir(), "manager-updates");
    }

    static File updateFile(Context context) {
        return new File(updateDirectory(context), FILE_NAME);
    }

    static Uri contentUri(Context context) {
        return new Uri.Builder()
            .scheme("content")
            .authority(context.getPackageName() + ".updates")
            .appendPath(FILE_NAME)
            .build();
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        requireUpdateUri(uri);
        return "application/vnd.android.package-archive";
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        requireUpdateUri(uri);
        File file = updateFile(providerContext());
        String[] requested = projection == null
            ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
            : projection;
        MatrixCursor cursor = new MatrixCursor(requested, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : requested) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(FILE_NAME);
            else if (OpenableColumns.SIZE.equals(column)) row.add(file.length());
            else row.add(null);
        }
        return cursor;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        requireUpdateUri(uri);
        if (!"r".equals(mode)) throw new FileNotFoundException("Update APK is read-only.");
        File file = updateFile(providerContext());
        if (!file.isFile()) throw new FileNotFoundException("Verified update APK is missing.");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only provider"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read-only provider"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read-only provider"); }

    private Context providerContext() {
        Context context = getContext();
        if (context == null) throw new IllegalStateException("Provider context is unavailable.");
        return context;
    }

    private void requireUpdateUri(Uri uri) {
        Context context = providerContext();
        if (!contentUri(context).equals(uri)) throw new SecurityException("Unsupported update URI.");
    }
}
