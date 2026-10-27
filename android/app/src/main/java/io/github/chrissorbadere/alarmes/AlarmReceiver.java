package io.github.chrissorbadere.alarmes;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import androidx.core.app.NotificationCompat;
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
            return;
        }
        if (AlarmStore.ACTION_SNOOZE.equals(action)) {
            nm.cancel(nid);
            snooze(c, nid, intent.getStringExtra("json"));
            return;
        }
        if (AlarmStore.ACTION_FIRE.equals(action)) {
            String json = intent.getStringExtra("json");
            JSONObject a;
            try {
                a = json != null ? new JSONObject(json) : new JSONObject();
            } catch (Exception e) {
                a = new JSONObject();
            }
            show(c, nid, a);
        }
    }

    static void snooze(Context c, int nid, String json) {
        JSONObject a;
        try {
            a = json != null ? new JSONObject(json) : new JSONObject();
        } catch (Exception e) {
            a = new JSONObject();
        }
        int snoozeNid = AlarmStore.SNOOZE_BASE + Math.abs(nid % 100000000);
        long at = System.currentTimeMillis() + AlarmStore.snoozeMinutes(c) * 60000L;
        try {
            a.put("nid", snoozeNid);
            a.put("at", at);
            a.put("snoozed", true);
        } catch (Exception ignored) {}
        AlarmStore.scheduleOne(c, snoozeNid, at, a);
    }

    static int parseColor(String s) {
        try {
            return Color.parseColor(s);
        } catch (Exception e) {
            return Color.parseColor("#2563eb");
        }
    }

    static void show(Context c, int nid, JSONObject a) {
        AlarmStore.ensureChannels(c);
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
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(c, nid, full, fl);

        Intent stop = new Intent(c, AlarmReceiver.class);
        stop.setAction(AlarmStore.ACTION_STOP);
        stop.putExtra("nid", nid);
        PendingIntent stopPi = PendingIntent.getBroadcast(c, nid, stop, fl);

        Intent sn = new Intent(c, AlarmReceiver.class);
        sn.setAction(AlarmStore.ACTION_SNOOZE);
        sn.putExtra("nid", nid);
        sn.putExtra("json", json);
        PendingIntent snPi = PendingIntent.getBroadcast(c, nid, sn, fl);

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
            .addAction(0, "Snooze " + AlarmStore.snoozeMinutes(c) + " min", snPi)
            .addAction(0, "Arrêter", stopPi)
            .setAutoCancel(!ring)
            .setOngoing(ring);
        if (ring) {
            b.setFullScreenIntent(fullPi, true);
            b.setDeleteIntent(stopPi);
        }
        Notification n = b.build();
        if (ring) n.flags |= Notification.FLAG_INSISTENT;
        try {
            nm.notify(nid, n);
        } catch (SecurityException e) {
            // Notifications refusées : on tente au moins l'écran d'alarme.
            if (ring) {
                try {
                    c.startActivity(full);
                } catch (Exception ignored) {}
            }
        }
    }
}
