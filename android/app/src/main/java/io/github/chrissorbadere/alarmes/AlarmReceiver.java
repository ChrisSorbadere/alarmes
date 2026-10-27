package io.github.chrissorbadere.alarmes;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        int nid = intent.getIntExtra("nid", 0);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);

        if (AlarmStore.ACTION_STOP.equals(action)) {
            nm.cancel(nid);
            AlarmStore.cancelOne(c, AlarmStore.snoozeNidOf(nid));
            if (AlarmService.ringingNid == nid && nid != 0) {
                Intent s = new Intent(c, AlarmService.class).setAction(AlarmService.ACTION_STOP).putExtra("nid", nid);
                try {
                    c.startService(s);
                } catch (Exception ignored) {}
            }
            return;
        }
        if (AlarmStore.ACTION_SNOOZE.equals(action)) {
            nm.cancel(nid);
            snooze(c, nid, intent.getStringExtra("json"), 0);
            return;
        }
        if (AlarmStore.ACTION_FIRE.equals(action)) {
            String json = intent.getStringExtra("json");
            JSONObject a = AlarmService.parse(json);
            boolean ring = !"notif".equals(a.optString("mode", "alarm"));
            if (!ring) {
                show(c, nid, a);
                return;
            }
            Intent s = new Intent(c, AlarmService.class)
                .setAction(AlarmService.ACTION_START)
                .putExtra("nid", nid)
                .putExtra("json", a.toString());
            try {
                ContextCompat.startForegroundService(c, s);
            } catch (Exception e) {
                Log.w(AlarmStore.TAG, "Service de sonnerie refusé, notification seule", e);
                show(c, nid, a);
            }
        }
    }

    static String hhmm(long at) {
        return new SimpleDateFormat("HH:mm", Locale.FRANCE).format(new Date(at));
    }

    /** Reprogramme l'alarme dans « snooze » minutes. Renvoie l'heure prévue. */
    static long snooze(Context c, int nid, String json, int ringIndex) {
        JSONObject a = AlarmService.parse(json);
        int snoozeNid = AlarmStore.snoozeNidOf(nid);
        long at = System.currentTimeMillis() + AlarmStore.snoozeMinutes(c) * 60000L;
        try {
            a.put("nid", snoozeNid);
            a.put("at", at);
            a.put("snoozed", true);
            a.put("ringIndex", ringIndex);
        } catch (Exception ignored) {}
        AlarmStore.scheduleOne(c, snoozeNid, at, a);
        return at;
    }

    static int parseColor(String s) {
        try {
            return Color.parseColor(s);
        } catch (Exception e) {
            return Color.parseColor("#2563eb");
        }
    }

    private static PendingIntent serviceAction(Context c, int nid, String action, String json) {
        Intent i = new Intent(c, AlarmService.class).setAction(action).putExtra("nid", nid);
        if (json != null) i.putExtra("json", json);
        return PendingIntent.getService(c, nid, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent receiverAction(Context c, int nid, String action, String json) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(action).putExtra("nid", nid);
        if (json != null) i.putExtra("json", json);
        return PendingIntent.getBroadcast(c, nid, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Notification affichée pendant que l'alarme sonne (son joué par AlarmService). */
    static Notification buildRingNotification(Context c, int nid, JSONObject a) {
        String title = a.optString("title", "Alarme");
        String body = a.optString("body", "");
        String json = a.toString();
        int color = parseColor(a.optString("color", "#2563eb"));

        Intent full = new Intent(c, AlarmActivity.class);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        full.putExtra("nid", nid);
        full.putExtra("json", json);
        PendingIntent fullPi = PendingIntent.getActivity(c, nid, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(c, AlarmStore.CH_ALARM)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setColor(color)
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullPi, true)
            .setContentIntent(fullPi)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(true)
            .addAction(0, "Snooze " + AlarmStore.snoozeMinutes(c) + " min", serviceAction(c, nid, AlarmService.ACTION_SNOOZE, json))
            .addAction(0, "Arrêter", serviceAction(c, nid, AlarmService.ACTION_STOP, null))
            .setDeleteIntent(serviceAction(c, nid, AlarmService.ACTION_STOP, null))
            .build();
    }

    /** Notification simple après une sonnerie sans réponse. */
    static void showInfo(Context c, int nid, JSONObject a, String status, boolean willRepeat) {
        AlarmStore.ensureChannels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        String title = a.optString("title", "Alarme");
        String body = a.optString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, AlarmStore.CH_SOFT)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(status + " — " + title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setColor(parseColor(a.optString("color", "#2563eb")))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(true)
            .setAutoCancel(true)
            .setContentIntent(AlarmStore.openAppPending(c, nid, a.optString("alarmId", null)));
        if (willRepeat) b.addAction(0, "Arrêter les répétitions", receiverAction(c, nid, AlarmStore.ACTION_STOP, null));
        try {
            nm.notify(nid, b.build());
        } catch (SecurityException ignored) {}
    }

    /** Rappel discret (mode « notif ») ou repli si le service ne peut pas démarrer. */
    static void show(Context c, int nid, JSONObject a) {
        AlarmStore.ensureChannels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        String title = a.optString("title", "Alarme");
        String body = a.optString("body", "");
        String alarmId = a.optString("alarmId", null);
        boolean ring = !"notif".equals(a.optString("mode", "alarm"));
        int color = parseColor(a.optString("color", "#2563eb"));
        String json = a.toString();

        Intent full = new Intent(c, AlarmActivity.class);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        full.putExtra("nid", nid);
        full.putExtra("json", json);
        PendingIntent fullPi = PendingIntent.getActivity(c, nid, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, ring ? AlarmStore.CH_RING : AlarmStore.CH_SOFT)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setColor(color)
            .setColorized(ring)
            .setCategory(ring ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(AlarmStore.openAppPending(c, nid, alarmId))
            .addAction(0, "Snooze " + AlarmStore.snoozeMinutes(c) + " min", receiverAction(c, nid, AlarmStore.ACTION_SNOOZE, json))
            .addAction(0, "Arrêter", receiverAction(c, nid, AlarmStore.ACTION_STOP, null))
            .setAutoCancel(!ring)
            .setOngoing(ring);
        if (ring) {
            b.setFullScreenIntent(fullPi, true);
            b.setDeleteIntent(receiverAction(c, nid, AlarmStore.ACTION_STOP, null));
        }
        Notification n = b.build();
        if (ring) n.flags |= Notification.FLAG_INSISTENT;
        try {
            nm.notify(nid, n);
        } catch (SecurityException e) {
            if (ring) {
                try {
                    c.startActivity(full);
                } catch (Exception ignored) {}
            }
        }
    }
}
