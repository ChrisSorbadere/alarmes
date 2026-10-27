package io.github.chrissorbadere.alarmes;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import org.json.JSONObject;

/**
 * Service au premier plan qui fait sonner une alarme :
 * joue le son choisi en boucle, vibre, s'arrête après la durée réglée,
 * puis relance l'alarme plus tard si des répétitions restent.
 */
public class AlarmService extends Service {
    static final String ACTION_START = "io.github.chrissorbadere.alarmes.RING_START";
    static final String ACTION_STOP = "io.github.chrissorbadere.alarmes.RING_STOP";
    static final String ACTION_SNOOZE = "io.github.chrissorbadere.alarmes.RING_SNOOZE";
    static final String ACTION_DONE = "io.github.chrissorbadere.alarmes.RING_DONE";

    static volatile int ringingNid = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private Runnable timeout;
    private int curNid = 0;
    private String curJson = null;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static JSONObject parse(String json) {
        try {
            return json != null ? new JSONObject(json) : new JSONObject();
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            if (curNid == 0) stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        int nid = intent.getIntExtra("nid", 0);
        String json = intent.getStringExtra("json");
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (ACTION_START.equals(action)) {
            if (curNid != 0 && curNid != nid) {
                // Une autre alarme sonnait encore : on l'arrête sans relance.
                int prev = curNid;
                stopSoundAndVibration();
                nm.cancel(prev);
            }
            curNid = nid;
            curJson = json;
            JSONObject a = parse(json);
            AlarmStore.ensureChannels(this);
            Notification n = AlarmReceiver.buildRingNotification(this, nid, a);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(nid, n);
                }
            } catch (Exception e) {
                Log.w(AlarmStore.TAG, "startForeground impossible", e);
                AlarmReceiver.show(this, nid, a);
                curNid = 0;
                stopSelf();
                return START_NOT_STICKY;
            }
            int minutes = Math.max(1, Math.min(5, a.optInt("durationMin", 2)));
            acquireWakeLock(minutes * 60000L + 30000L);
            startSound(a.optString("soundUri", ""));
            startVibration();
            ringingNid = nid;
            if (timeout != null) handler.removeCallbacks(timeout);
            timeout = this::onTimeout;
            handler.postDelayed(timeout, minutes * 60000L);
            return START_NOT_STICKY;
        }

        if (nid == 0) nid = curNid;

        if (ACTION_STOP.equals(action)) {
            AlarmStore.cancelOne(this, AlarmStore.snoozeNidOf(nid));
            finishRing();
            nm.cancel(nid);
            return START_NOT_STICKY;
        }

        if (ACTION_SNOOZE.equals(action)) {
            String j = json != null ? json : curJson;
            finishRing();
            nm.cancel(nid);
            AlarmReceiver.snooze(this, nid, j, 0);
            return START_NOT_STICKY;
        }

        if (curNid == 0) stopSelf();
        return START_NOT_STICKY;
    }

    /** Personne n'a arrêté l'alarme pendant la durée prévue. */
    private void onTimeout() {
        int nid = curNid;
        String json = curJson;
        JSONObject a = parse(json);
        int done = a.optInt("ringIndex", 0);
        int max = Math.max(0, Math.min(5, a.optInt("repeats", 0)));
        finishRing();
        if (done < max) {
            long at = AlarmReceiver.snooze(this, nid, json, done + 1);
            AlarmReceiver.showInfo(this, nid, a,
                "Pas de réponse : nouvelle sonnerie à " + AlarmReceiver.hhmm(at) + " (" + (done + 1) + "/" + max + ")",
                true);
        } else {
            AlarmReceiver.showInfo(this, nid, a, "Alarme manquée", false);
        }
    }

    private void finishRing() {
        if (timeout != null) handler.removeCallbacks(timeout);
        timeout = null;
        stopSoundAndVibration();
        releaseWakeLock();
        int nid = curNid;
        ringingNid = 0;
        curNid = 0;
        curJson = null;
        Intent done = new Intent(ACTION_DONE);
        done.setPackage(getPackageName());
        done.putExtra("nid", nid);
        sendBroadcast(done);
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    private static AudioAttributes alarmAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    static MediaPlayer createPlayer(Context c, String soundUri, boolean loop) {
        Uri[] candidates = new Uri[] {
            soundUri != null && !soundUri.isEmpty() ? Uri.parse(soundUri) : null,
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
        };
        for (Uri u : candidates) {
            if (u == null) continue;
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setAudioAttributes(alarmAttributes());
                mp.setDataSource(c, u);
                mp.setLooping(loop);
                mp.prepare();
                return mp;
            } catch (Exception e) {
                Log.w(AlarmStore.TAG, "Son illisible : " + u, e);
                try {
                    mp.release();
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    private void startSound(String soundUri) {
        stopSound();
        player = createPlayer(this, soundUri, true);
        if (player != null) {
            try {
                player.start();
            } catch (Exception e) {
                Log.w(AlarmStore.TAG, "Lecture impossible", e);
            }
        }
    }

    private void stopSound() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {}
            try {
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
    }

    private void startVibration() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = new long[] { 0, 800, 600 };
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), alarmAttributes());
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception e) {
            Log.w(AlarmStore.TAG, "Vibration impossible", e);
        }
    }

    private void stopSoundAndVibration() {
        stopSound();
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private void acquireWakeLock(long ms) {
        releaseWakeLock();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Alarmes:sonnerie");
            wakeLock.acquire(ms);
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) wakeLock.release();
            } catch (Exception ignored) {}
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        if (timeout != null) handler.removeCallbacks(timeout);
        stopSoundAndVibration();
        releaseWakeLock();
        ringingNid = 0;
        super.onDestroy();
    }
}
