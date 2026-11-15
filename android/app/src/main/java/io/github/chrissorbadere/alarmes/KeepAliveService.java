package io.github.chrissorbadere.alarmes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Service « garde » : notification permanente discrète qui montre la prochaine alarme.
 * Une appli qui affiche une notification de premier plan est épargnée par les gestionnaires
 * d'énergie (realme/ColorOS), qui sinon l'arrêtent de force et effacent ses alarmes.
 */
public class KeepAliveService extends Service {
    static final int NID = 1777777777;
    static final String CH = "garde";
    static final String PREF = "garde";

    static boolean enabled(Context c) {
        return AlarmStore.prefs(c).getBoolean(PREF, false);
    }

    static void setEnabled(Context c, boolean on) {
        AlarmStore.prefs(c).edit().putBoolean(PREF, on).apply();
        if (on) start(c, "activée");
        else c.stopService(new Intent(c, KeepAliveService.class));
    }

    /** Démarre ou met à jour la notification (sans effet si la garde est désactivée). */
    static void start(Context c, String why) {
        if (!enabled(c)) return;
        try {
            Intent i = new Intent(c, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception e) {
            AlarmStore.log(c, "Garde : démarrage refusé par Android (" + e.getClass().getSimpleName() + ")" + (why != null ? " · " + why : ""));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build(this);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NID, n);
        } catch (Exception e) {
            AlarmStore.log(this, "Garde : notification refusée (" + e.getClass().getSimpleName() + ")");
            stopSelf();
            return START_NOT_STICKY;
        }
        return enabled(this) ? START_STICKY : START_NOT_STICKY;
    }

    static Notification build(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Garde des alarmes", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Notification permanente qui empêche le système de fermer l'appli et d'effacer les alarmes");
                ch.setShowBadge(false);
                ch.setSound(null, null);
                ch.enableVibration(false);
                nm.createNotificationChannel(ch);
            }
        }
        JSONArray list = AlarmStore.load(c);
        JSONObject next = null;
        long now = System.currentTimeMillis();
        int n = 0;
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null || o.optLong("at") <= now) continue;
            n++;
            if (next == null || o.optLong("at") < next.optLong("at")) next = o;
        }
        String title = next == null ? "Alarmes actives" : "Prochaine : " + new java.text.SimpleDateFormat("EEE d/MM 'à' HH:mm", java.util.Locale.FRANCE).format(new java.util.Date(next.optLong("at")));
        String text = next == null ? "Aucune alarme programmée" : next.optString("title", "Alarme") + " · " + n + " programmée" + (n > 1 ? "s" : "");
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, NID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(c, CH)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
