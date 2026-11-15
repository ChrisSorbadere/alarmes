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

    static final String KEY_LOG = "journal";
    static final String KEY_FIRED = "declenchees";
    static final String KEY_SINCE = "suivi_depuis";

    private AlarmStore() {}

    /** Journal de diagnostic (300 dernières lignes). */
    static synchronized void log(Context c, String msg) {
        try {
            SharedPreferences p = prefs(c);
            JSONArray a = new JSONArray(p.getString(KEY_LOG, "[]"));
            JSONObject last = a.length() > 0 ? a.optJSONObject(a.length() - 1) : null;
            if (last != null && msg.equals(last.optString("m"))) {
                last.put("t", System.currentTimeMillis());
                p.edit().putString(KEY_LOG, a.toString()).apply();
                return;
            }
            JSONObject o = new JSONObject();
            o.put("t", System.currentTimeMillis());
            o.put("m", msg);
            a.put(o);
            JSONArray out = new JSONArray();
            for (int i = Math.max(0, a.length() - 300); i < a.length(); i++) out.put(a.get(i));
            SharedPreferences.Editor e = p.edit().putString(KEY_LOG, out.toString());
            if (!p.contains(KEY_SINCE)) e.putLong(KEY_SINCE, System.currentTimeMillis());
            e.apply();
        } catch (Exception ignored) {}
        Log.i(TAG, msg);
    }

    /** Mémorise qu'une alarme a bien été reçue (pour repérer les alarmes manquées). */
    static synchronized void markFired(Context c, int nid) {
        try {
            SharedPreferences p = prefs(c);
            JSONObject f = new JSONObject(p.getString(KEY_FIRED, "{}"));
            long now = System.currentTimeMillis();
            f.put(String.valueOf(nid), now);
            JSONObject out = new JSONObject();
            java.util.Iterator<String> it = f.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (now - f.optLong(k) < 8L * 86400000L) out.put(k, f.optLong(k));
            }
            SharedPreferences.Editor e = p.edit().putString(KEY_FIRED, out.toString());
            if (!p.contains(KEY_SINCE)) e.putLong(KEY_SINCE, now);
            e.apply();
        } catch (Exception ignored) {}
    }

    static String hm(long t) {
        return new java.text.SimpleDateFormat("EEE d/MM HH:mm", java.util.Locale.FRANCE).format(new java.util.Date(t));
    }

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

    static String lastScheduleError = null;

    /** Programme une alarme. Renvoie false si Android l'a refusée (jamais d'exception). */
    static boolean scheduleOne(Context c, int nid, long at, JSONObject a) {
        try {
            scheduleOneUnsafe(c, nid, at, a);
            return true;
        } catch (Exception e) {
            lastScheduleError = e.getClass().getSimpleName() + (e.getMessage() != null ? " : " + e.getMessage() : "");
            Log.w(TAG, "Programmation refusée", e);
            return false;
        }
    }

    private static void scheduleOneUnsafe(Context c, int nid, long at, JSONObject a) {
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
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            am.cancel(firePending(c, nid, null));
        } catch (Exception e) {
            Log.w(TAG, "Annulation impossible", e);
        }
    }

    /** Alarme de secours : crée une alarme dans l'Horloge du téléphone (une seule fois par horaire). */
    static synchronized boolean clockBackup(Context c, long at, String label) {
        try {
            SharedPreferences p = prefs(c);
            JSONArray done = new JSONArray(p.getString("secours", "[]"));
            long now = System.currentTimeMillis();
            JSONArray keep = new JSONArray();
            for (int i = 0; i < done.length(); i++) {
                long t = done.optLong(i);
                if (t == at) return false;
                if (t > now - 86400000L) keep.put(t);
            }
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.setTimeInMillis(at);
            Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
                .putExtra(android.provider.AlarmClock.EXTRA_HOUR, cal.get(java.util.Calendar.HOUR_OF_DAY))
                .putExtra(android.provider.AlarmClock.EXTRA_MINUTES, cal.get(java.util.Calendar.MINUTE))
                .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label)
                .putExtra(android.provider.AlarmClock.EXTRA_VIBRATE, true)
                .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            keep.put(at);
            p.edit().putString("secours", keep.toString()).apply();
            log(c, "Secours : alarme créée dans l'Horloge du téléphone pour " + hm(at));
            return true;
        } catch (Exception e) {
            log(c, "ERREUR : secours impossible dans l'Horloge (" + e.getClass().getSimpleName() + ")");
            return false;
        }
    }

    /** État du système pour cette appli (diagnostic). */
    static String sysState(Context c) {
        StringBuilder sb = new StringBuilder();
        try {
            sb.append("Android ").append(Build.VERSION.RELEASE).append(" · ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL);
            sb.append(" · heure exacte ").append(canExact(c) ? "oui" : "NON");
            if (Build.VERSION.SDK_INT >= 23) {
                android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
                sb.append(" · batterie non optimisée ").append(pm.isIgnoringBatteryOptimizations(c.getPackageName()) ? "oui" : "NON");
            }
            if (Build.VERSION.SDK_INT >= 28) {
                android.app.ActivityManager am = (android.app.ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
                sb.append(" · arrière-plan ").append(am.isBackgroundRestricted() ? "RESTREINT" : "autorisé");
                android.app.usage.UsageStatsManager us = (android.app.usage.UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
                int b = us.getAppStandbyBucket();
                sb.append(" · classement ").append(b <= 10 ? "actif" : b <= 20 ? "régulier" : b <= 30 ? "fréquent" : b <= 40 ? "rare" : "RESTREINT").append(" (").append(b).append(')');
            }
        } catch (Exception e) {
            sb.append(" · état illisible");
        }
        return sb.toString();
    }

    static boolean bgRestricted(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 28) return ((android.app.ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE)).isBackgroundRestricted();
        } catch (Exception ignored) {}
        return false;
    }

    /** Note dans le journal pourquoi Android a arrêté l'appli depuis la dernière ouverture. */
    static void logExits(Context c) {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            android.app.ActivityManager am = (android.app.ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            java.util.List<android.app.ApplicationExitInfo> l = am.getHistoricalProcessExitReasons(c.getPackageName(), 0, 12);
            SharedPreferences p = prefs(c);
            long last = p.getLong("dernier_arret", 0), max = last;
            for (int i = l.size() - 1; i >= 0; i--) {
                android.app.ApplicationExitInfo e = l.get(i);
                long t = e.getTimestamp();
                if (t <= last) continue;
                if (t > max) max = t;
                String d = e.getDescription();
                String dl = d == null ? "" : d.toLowerCase(java.util.Locale.ROOT);
                boolean forced = dl.startsWith("stop ") || dl.contains("force") || dl.contains("forcestop");
                log(c, (forced ? "ARRÊT FORCÉ" : "Appli arrêtée") + " " + hm(t) + " : " + exitLabel(e.getReason())
                    + (d != null && !d.isEmpty() ? " [" + d + "]" : "")
                    + (forced ? " → Android efface alors toutes les alarmes" : ""));
            }
            if (max > last) p.edit().putLong("dernier_arret", max).apply();
        } catch (Exception e) {
            Log.w(TAG, "Raisons d'arrêt illisibles", e);
        }
    }

    static String exitLabel(int r) {
        switch (r) {
            case 1: return "s'est fermée seule";
            case 2: return "tuée par le système (signal)";
            case 3: return "mémoire insuffisante";
            case 4: case 5: return "plantage";
            case 6: return "appli bloquée (ANR)";
            case 8: return "autorisation modifiée";
            case 9: return "consommation jugée excessive";
            case 10: return "fermée par l'utilisateur ou le système (balayage, « Tout fermer », arrêt forcé)";
            case 11: return "session utilisateur arrêtée";
            case 12: return "un composant dont elle dépend s'est arrêté";
            case 13: return "arrêtée par le système (autre)";
            case 14: return "gelée par le système";
            case 15: return "état de l'appli modifié (désactivée/gelée)";
            case 16: return "mise à jour de l'appli";
            default: return "raison " + r;
        }
    }

    /** Remplace toutes les alarmes programmées par la nouvelle liste. */
    static int replaceAll(Context c, JSONArray list) {
        JSONArray old = load(c);
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null) cancelOne(c, o.optInt("nid"));
        }
        long now = System.currentTimeMillis();
        int failed = 0;
        JSONArray kept = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            if (at <= now) continue;
            // gardée dans la liste même si refusée : elle sera annulée/reprogrammée proprement au prochain passage
            kept.put(o);
            if (!scheduleOne(c, o.optInt("nid"), at, o)) failed++;
        }
        prefs(c).edit().putString(KEY_LIST, kept.toString()).apply();
        if (failed > 0) log(c, "ERREUR : " + failed + " alarme(s) refusée(s) par Android (" + lastScheduleError + ")");
        return kept.length() - failed;
    }

    static String firstLabel(JSONArray list) {
        JSONObject best = null;
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && (best == null || o.optLong("at") < best.optLong("at"))) best = o;
        }
        return best == null ? "aucune" : hm(best.optLong("at")) + " « " + best.optString("title") + " »";
    }

    /** Reprogramme après redémarrage ou mise à jour. */
    static int rescheduleStored(Context c) {
        JSONArray list = load(c);
        long now = System.currentTimeMillis();
        int n = 0;
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            if (at > now && scheduleOne(c, o.optInt("nid"), at, o)) n++;
        }
        return n;
    }
}
