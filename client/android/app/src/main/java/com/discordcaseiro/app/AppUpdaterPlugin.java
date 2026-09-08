package com.discordcaseiro.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getInstallPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canInstallPackages());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        Long expectedSize = call.getLong("size");
        String fileName = call.getString("fileName", "discordia-update.apk");

        if (url == null || expectedSha256 == null || expectedSize == null
            || !expectedSha256.matches("(?i)^[a-f0-9]{64}$")
            || !fileName.matches("^[a-zA-Z0-9._-]+\\.apk$")
            || expectedSize <= 0) {
            call.reject("Metadados da atualizacao invalidos.", "INVALID_UPDATE");
            return;
        }

        executor.execute(() -> {
            File tempFile = null;
            try {
                File updateDir = new File(getContext().getCacheDir(), "updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IllegalStateException("Nao foi possivel criar o cache de atualizacao.");
                }
                File apkFile = new File(updateDir, fileName);
                if (!matches(apkFile, expectedSize, expectedSha256)) {
                    tempFile = new File(updateDir, fileName + ".part");
                    download(url, tempFile, expectedSize);
                    if (!matches(tempFile, expectedSize, expectedSha256)) {
                        throw new SecurityException("O APK baixado nao corresponde ao SHA-256 publicado.");
                    }
                    if (apkFile.exists() && !apkFile.delete()) {
                        throw new IllegalStateException("Nao foi possivel substituir o APK em cache.");
                    }
                    if (!tempFile.renameTo(apkFile)) {
                        throw new IllegalStateException("Nao foi possivel finalizar o APK baixado.");
                    }
                    tempFile = null;
                }

                if (!canInstallPackages()) {
                    call.reject("Permita que o Discordia instale apps para continuar.", "INSTALL_PERMISSION_REQUIRED");
                    return;
                }

                File finalApk = apkFile;
                getActivity().runOnUiThread(() -> {
                    try {
                        openInstaller(finalApk);
                        JSObject result = new JSObject();
                        result.put("installerOpened", true);
                        call.resolve(result);
                    } catch (Exception err) {
                        call.reject("Nao foi possivel abrir o instalador do Android.", "INSTALLER_FAILED", err);
                    }
                });
            } catch (SecurityException err) {
                call.reject(err.getMessage(), "CHECKSUM_MISMATCH", err);
            } catch (Exception err) {
                call.reject("Falha ao baixar a atualizacao: " + err.getMessage(), "DOWNLOAD_FAILED", err);
            } finally {
                if (tempFile != null && tempFile.exists()) tempFile.delete();
            }
        });
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void download(String address, File target, long expectedSize) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            long total = connection.getContentLengthLong();
            if (total > 0 && total != expectedSize) {
                throw new SecurityException("Tamanho remoto diferente do manifesto.");
            }

            long received = 0;
            byte[] buffer = new byte[64 * 1024];
            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(target, false)) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    received += count;
                    JSObject progress = new JSObject();
                    progress.put("received", received);
                    progress.put("total", expectedSize);
                    progress.put("percent", Math.min(100d, received * 100d / expectedSize));
                    notifyListeners("downloadProgress", progress);
                }
                output.getFD().sync();
            }
        } finally {
            connection.disconnect();
        }
    }

    private boolean matches(File file, long expectedSize, String expectedSha256) throws Exception {
        if (!file.isFile() || file.length() != expectedSize) return false;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder actual = new StringBuilder();
        for (byte item : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", item));
        return actual.toString().equalsIgnoreCase(expectedSha256);
    }

    private void openInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
