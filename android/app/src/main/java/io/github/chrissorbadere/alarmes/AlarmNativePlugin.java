package io.github.chrissorbadere.alarmes;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Set;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "AlarmNative",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class AlarmNativePlugin extends Plugin {
    private String pendingOpen = null;
    private MediaPlayer previewPlayer = null;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable stopPreviewTask = this::releasePreview;

    @Override
    public void load() {
        AlarmStore.ensureChannels(getContext());
        Intent i = getActivity().getIntent();
        if (i != null) pendingOpen = i.getStringExtra("openAlarm");
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String id = intent.getStringExtra("openAlarm");
        if (id != null) {
            JSObject r = new JSObject();
            r.put("alarmId", id);
            notifyListeners("openAlarm", r, true);
        }
    }

    @PluginMethod
    public void getLaunchAlarm(PluginCall call) {
        JSObject r = new JSObject();
        r.put("alarmId", pendingOpen);
        pendingOpen = null;
        call.resolve(r);
    }

    @PluginMethod
    public void setAll(PluginCall call) {
        JSArray arr = call.getArray("alarms", new JSArray());
        Integer snooze = call.getInt("snoozeMin", 10);
        Context c = getContext();
        AlarmStore.prefs(c).edit().putInt(AlarmStore.KEY_SNOOZE, snooze == null ? 10 : snooze).apply();
        int n;
        try {
            n = AlarmStore.replaceAll(c, new JSONArray(arr.toString()));
        } catch (Exception e) {
            call.reject("Programmation impossible : " + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("scheduled", n);
        call.resolve(r);
    }

    @PluginMethod
    public void test(PluginCall call) {
        int seconds = call.getInt("seconds", 5);
        JSObject a = new JSObject();
        a.put("nid", 1899999999);
        a.put("title", call.getString("title", "Test d'alarme"));
        a.put("body", call.getString("body", "Si tu vois cet écran, les alarmes fonctionnent."));
        a.put("color", call.getString("color", "#dc2626"));
        a.put("levelLabel", call.getString("levelLabel", "Test"));
        a.put("mode", call.getString("mode", "alarm"));
        a.put("soundUri", call.getString("soundUri", ""));
        a.put("durationMin", call.getInt("durationMin", 1));
        a.put("repeats", call.getInt("repeats", 0));
        a.put("ringIndex", 0);
        a.put("alarmId", call.getString("alarmId", ""));
        a.put("photoCount", call.getInt("photoCount", 0));
        a.put("contactName", call.getString("contactName", ""));
        a.put("contactPhone", call.getString("contactPhone", ""));
        a.put("placeLabel", call.getString("placeLabel", ""));
        a.put("placeNavUrl", call.getString("placeNavUrl", ""));
        long at = System.currentTimeMillis() + seconds * 1000L;
        a.put("at", at);
        try {
            AlarmStore.scheduleOne(getContext(), 1899999999, at, new JSONObject(a.toString()));
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("exact", AlarmStore.canExact(c));
        boolean fsi = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            fsi = nm.canUseFullScreenIntent();
        }
        r.put("fullScreen", fsi);
        r.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        boolean battery = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            battery = pm.isIgnoringBatteryOptimizations(c.getPackageName());
        }
        r.put("batteryFree", battery);
        r.put("scheduled", AlarmStore.load(c).length());
        r.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifCallback");
    }

    @PermissionCallback
    private void notifCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    private void launch(Intent i, PluginCall call) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(app);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Réglage introuvable");
            }
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "app");
        String pkg = getContext().getPackageName();
        Intent i;
        switch (which) {
            case "exact":
                i = Build.VERSION.SDK_INT >= 31
                    ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg))
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                break;
            case "fullScreen":
                i = Build.VERSION.SDK_INT >= 34
                    ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg))
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= 26) {
                    i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                } else {
                    i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                }
                break;
            case "overlay":
                i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg));
                break;
            case "battery":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        launch(i, call);
    }

    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, i, "contactResult");
    }

    @ActivityCallback
    private void contactResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Uri uri = result.getData().getData();
        String[] proj = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        try (Cursor cur = getContext().getContentResolver().query(uri, proj, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                r.put("name", cur.getString(0));
                r.put("phone", cur.getString(1));
            }
        } catch (Exception e) {
            call.reject("Lecture du contact impossible : " + e.getMessage());
            return;
        }
        call.resolve(r);
    }

    // ---------- Choix du son ----------

    @PluginMethod
    public void pickSystemSound(PluginCall call) {
        Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALL);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Son de l'alarme");
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
        String cur = call.getString("current", "");
        if (cur != null && !cur.isEmpty()) i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(cur));
        try {
            startActivityForResult(call, i, "systemSoundResult");
        } catch (Exception e) {
            call.reject("Sélecteur de sonneries indisponible");
        }
    }

    @SuppressWarnings("deprecation")
    @ActivityCallback
    private void systemSoundResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent data = result.getData();
        Uri uri = data != null ? (Uri) data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI) : null;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || uri == null) {
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        String name = "Son du téléphone";
        try {
            Ringtone rt = RingtoneManager.getRingtone(getContext(), uri);
            if (rt != null) name = rt.getTitle(getContext());
        } catch (Exception ignored) {}
        r.put("uri", uri.toString());
        r.put("name", name);
        call.resolve(r);
    }

    @PluginMethod
    public void pickFileSound(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("audio/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, i, "fileSoundResult");
        } catch (Exception e) {
            call.reject("Sélecteur de fichiers indisponible");
        }
    }

    @ActivityCallback
    private void fileSoundResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || uri == null) {
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        String name = "Fichier audio";
        try (Cursor cur = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cur != null && cur.moveToFirst() && cur.getString(0) != null) name = cur.getString(0).replaceAll("\\.[^.]+$", "");
        } catch (Exception ignored) {}
        r.put("uri", uri.toString());
        r.put("name", name);
        call.resolve(r);
    }

    @PluginMethod
    public void previewSound(PluginCall call) {
        releasePreview();
        previewPlayer = AlarmService.createPlayer(getContext(), call.getString("uri", ""), false);
        if (previewPlayer == null) {
            call.reject("Son illisible");
            return;
        }
        previewPlayer.setOnCompletionListener(mp -> releasePreview());
        previewPlayer.start();
        handler.postDelayed(stopPreviewTask, 10000);
        call.resolve();
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        releasePreview();
        call.resolve();
    }

    private void releasePreview() {
        handler.removeCallbacks(stopPreviewTask);
        if (previewPlayer != null) {
            try {
                previewPlayer.stop();
            } catch (Exception ignored) {}
            try {
                previewPlayer.release();
            } catch (Exception ignored) {}
            previewPlayer = null;
        }
    }

    // ---------- Photos jointes (copiées pour l'écran de sonnerie) ----------

    static String safeId(String id) {
        return id == null ? "x" : id.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    private File photoDir() {
        File d = new File(getContext().getFilesDir(), "photos");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    @PluginMethod
    public void setPhotos(PluginCall call) {
        String id = safeId(call.getString("id", ""));
        JSArray arr = call.getArray("photos", new JSArray());
        File dir = photoDir();
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (f.getName().startsWith(id + "_")) f.delete();
        int n = 0;
        try {
            for (int i = 0; i < arr.length(); i++) {
                String s = arr.getString(i);
                int comma = s.indexOf(',');
                byte[] bytes = Base64.decode(comma >= 0 ? s.substring(comma + 1) : s, Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(new File(dir, id + "_" + n + ".jpg"))) {
                    out.write(bytes);
                }
                n++;
            }
        } catch (Exception e) {
            call.reject("Copie des photos impossible : " + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("count", n);
        call.resolve(r);
    }

    @PluginMethod
    public void prunePhotos(PluginCall call) {
        JSArray arr = call.getArray("keep", new JSArray());
        Set<String> keep = new HashSet<>();
        try {
            for (int i = 0; i < arr.length(); i++) keep.add(safeId(arr.getString(i)));
        } catch (Exception ignored) {}
        File[] files = photoDir().listFiles();
        int removed = 0;
        if (files != null) {
            for (File f : files) {
                String name = f.getName();
                int us = name.lastIndexOf('_');
                String owner = us > 0 ? name.substring(0, us) : name;
                if (!keep.contains(owner) && f.delete()) removed++;
            }
        }
        JSObject r = new JSObject();
        r.put("removed", removed);
        call.resolve(r);
    }
}
