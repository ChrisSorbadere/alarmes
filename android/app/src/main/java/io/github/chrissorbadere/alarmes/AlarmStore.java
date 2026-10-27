package io.github.chrissorbadere.alarmes;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

/** Stockage et programmation des alarmes natives (AlarmManager). */
public final class AlarmStore {
    static final String TAG = "Alarmes";
    static final String PREFS = "alarmes_natives";
    static final String KEY_LIST = "liste";
    static final String KEY_SNOOZE = "snooze_min";
    static final String CH_RING = "alarmes_sonnerie_v1";
    static final String CH_SOFT = "alarmes_douces_v1";
    static final String CH_ALARM = "alarmes_sonnerie_v2";
    static final String ACTION_FIRE = "io.github.chrissorbadere.alarmes.FIRE";
    static final String ACTION_STOP = "io.github.chrissorbadere.alarmes.STOP";
    static final String ACTION_SNOOZE = "io.github.chrissorbadere.alarmes.SNOOZE";
    static final int SNOOZE_BASE = 1900000000;

    private AlarmStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray load(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY_LIST, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static int snoozeMinutes(Context c) {
        return prefs(c).getInt(KEY_SNOOZE, 10);
    }

    static int snoozeNidOf(int nid) {
        return SNOOZE_BASE + Math.abs(nid % 100000000);
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH_ALARM) == null) {
            NotificationChannel ch = new NotificationChannel(CH_ALARM, "Alarmes", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Écran d'alarme ; le son et la vibration sont gérés par l'appli");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_RING) == null) {
            NotificationChannel ch = new NotificationChannel(CH_RING, "Alarmes (sonnerie)", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Alarmes qui sonnent jusqu'à ce que tu les arrêtes");
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(sound, aa);
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] { 0, 800, 400, 800, 400, 800 });
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_SOFT) == null) {
            NotificationChannel ch = new NotificationChannel(CH_SOFT, "Rappels discrets", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Rappels avec un simple son de notification");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
    }

    static PendingIntent firePending(Context c, int nid, JSONObject a) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra("nid", nid);
        if (a != null) i.putExtra("json", a.toString());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, nid, i, flags);
    }

    static PendingIntent openAppPending(Context c, int req, String alarmId) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (alarmId != null) i.putExtra("openAlarm", alarmId);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am.canScheduleExactAlarms();
    }

    static void scheduleOne(Context c, int nid, long at, JSONObject a) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePending(c, nid, a);
        String alarmId = a != null ? a.optString("alarmId", null) : null;
        try {
            if (canExact(c)) {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openAppPending(c, nid, alarmId)), pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Alarme exacte refusée, repli inexact", e);
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.set(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancelOne(Context c, int nid) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(firePending(c, nid, null));
    }

    /** Remplace toutes les alarmes programmées par la nouvelle liste. */
    static int replaceAll(Context c, JSONArray list) {
        JSONArray old = load(c);
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null) cancelOne(c, o.optInt("nid"));
        }
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            if (at <= now) continue;
            scheduleOne(c, o.optInt("nid"), at, o);
            kept.put(o);
        }
        prefs(c).edit().putString(KEY_LIST, kept.toString()).apply();
        return kept.length();
    }

    /** Reprogramme après redémarrage ou mise à jour. */
    static void rescheduleStored(Context c) {
        JSONArray list = load(c);
        long now = System.currentTimeMillis();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            if (at > now) scheduleOne(c, o.optInt("nid"), at, o);
        }
    }
}
