package io.github.chrissorbadere.alarmes;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
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
}
