package io.github.chrissorbadere.alarmes;

import android.app.Activity;
import android.app.Dialog;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/** Écran plein qui s'affiche quand une alarme sonne, même téléphone verrouillé. */
public class AlarmActivity extends Activity {
    private int nid;
    private String json;
    private JSONObject data;
    private boolean registered = false;
    private boolean launching = false;
    private final BroadcastReceiver doneReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int n = i.getIntExtra("nid", 0);
            if (!launching && (n == 0 || n == nid)) finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        load(getIntent());
        build();
        ContextCompat.registerReceiver(this, doneReceiver, new IntentFilter(AlarmService.ACTION_DONE), ContextCompat.RECEIVER_NOT_EXPORTED);
        registered = true;
    }

    @Override
    protected void onDestroy() {
        if (registered) {
            try {
                unregisterReceiver(doneReceiver);
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        load(intent);
        build();
    }

    private void load(Intent intent) {
        nid = intent.getIntExtra("nid", 0);
        json = intent.getStringExtra("json");
        data = AlarmService.parse(json);
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private static boolean isLight(int c) {
        double l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255.0;
        return l > 0.62;
    }

    private Button button(String label, int bg, int fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTextColor(fg);
        b.setSingleLine(true);
        b.setEllipsize(android.text.TextUtils.TruncateAt.END);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(16));
        b.setBackground(d);
        b.setPadding(dp(10), dp(12), dp(10), dp(12));
        return b;
    }

    /** Charge une photo réduite pour ne pas saturer la mémoire. */
    static Bitmap loadPhoto(File f, int maxPx) {
        if (f == null || !f.exists()) return null;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= maxPx) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        try {
            return BitmapFactory.decodeFile(f.getAbsolutePath(), o2);
        } catch (OutOfMemoryError e) {
            return null;
        }
    }

    static File photoFile(Context c, String alarmId, int i) {
        return new File(new File(c.getFilesDir(), "photos"), AlarmNativePlugin.safeId(alarmId) + "_" + i + ".jpg");
    }

    private void showPhotoFull(File f) {
        Bitmap bm = loadPhoto(f, 2048);
        if (bm == null) return;
        Dialog d = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        ImageView iv = new ImageView(this);
        iv.setImageBitmap(bm);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iv.setBackgroundColor(Color.BLACK);
        iv.setOnClickListener(v -> d.dismiss());
        d.setContentView(iv);
        if (d.getWindow() != null) d.getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
        d.show();
    }

    private void build() {
        int color = AlarmReceiver.parseColor(data.optString("color", "#2563eb"));
        int fg = isLight(color) ? Color.parseColor("#111111") : Color.WHITE;
        int soft = isLight(color) ? Color.argb(40, 0, 0, 0) : Color.argb(50, 255, 255, 255);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color);
        root.setPadding(dp(20), dp(40), dp(20), dp(24));

        TextView time = new TextView(this);
        time.setText(new SimpleDateFormat("HH:mm", Locale.FRANCE).format(new Date()));
        time.setTextSize(TypedValue.COMPLEX_UNIT_SP, 56);
        time.setTypeface(Typeface.DEFAULT_BOLD);
        time.setTextColor(fg);
        time.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(time);

        String tag = data.optString("levelLabel", "");
        if (!tag.isEmpty()) {
            TextView lvl = new TextView(this);
            lvl.setText(tag.toUpperCase(Locale.FRANCE));
            lvl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            lvl.setLetterSpacing(0.15f);
            lvl.setTextColor(fg);
            lvl.setGravity(Gravity.CENTER_HORIZONTAL);
            root.addView(lvl);
        }

        TextView title = new TextView(this);
        title.setText(data.optString("title", "Alarme"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(fg);
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        title.setPadding(0, dp(12), 0, dp(12));
        root.addView(title);

        // Photos jointes
        String alarmId = data.optString("alarmId", "");
        int photoCount = data.optInt("photoCount", 0);
        if (photoCount > 0 && !alarmId.isEmpty()) {
            HorizontalScrollView hs = new HorizontalScrollView(this);
            hs.setHorizontalScrollBarEnabled(false);
            LinearLayout strip = new LinearLayout(this);
            strip.setOrientation(LinearLayout.HORIZONTAL);
            int h = dp(photoCount == 1 ? 190 : 150);
            int shown = 0;
            for (int i = 0; i < photoCount; i++) {
                File f = photoFile(this, alarmId, i);
                Bitmap bm = loadPhoto(f, 900);
                if (bm == null) continue;
                ImageView iv = new ImageView(this);
                iv.setImageBitmap(bm);
                iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
                iv.setClipToOutline(true);
                GradientDrawable bg = new GradientDrawable();
                bg.setCornerRadius(dp(14));
                bg.setColor(soft);
                iv.setBackground(bg);
                int w = photoCount == 1 ? ViewGroup.LayoutParams.MATCH_PARENT : (int) (h * Math.max(0.6, Math.min(1.6, bm.getWidth() / (double) bm.getHeight())));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(w, h);
                if (shown > 0) lp.setMargins(dp(8), 0, 0, 0);
                iv.setOnClickListener(v -> showPhotoFull(f));
                strip.addView(iv, lp);
                shown++;
            }
            if (shown > 0) {
                if (photoCount == 1) {
                    root.addView(strip, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, h));
                } else {
                    hs.addView(strip);
                    root.addView(hs, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, h));
                }
                TextView hint = new TextView(this);
                hint.setText("Touche une photo pour l'agrandir");
                hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                hint.setTextColor(fg);
                hint.setAlpha(0.8f);
                hint.setGravity(Gravity.CENTER_HORIZONTAL);
                hint.setPadding(0, dp(4), 0, dp(10));
                root.addView(hint);
            }
        }

        ScrollView sv = new ScrollView(this);
        GradientDrawable box = new GradientDrawable();
        box.setColor(soft);
        box.setCornerRadius(dp(16));
        sv.setBackground(box);
        TextView body = new TextView(this);
        String txt = data.optString("body", "");
        body.setText(txt.isEmpty() ? "(pas de description)" : txt);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        body.setLineSpacing(0, 1.2f);
        body.setTextColor(fg);
        body.setPadding(dp(16), dp(12), dp(16), dp(12));
        sv.addView(body);
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        // Contact et lieu
        String phone = data.optString("contactPhone", "");
        String cname = data.optString("contactName", "");
        String navUrl = data.optString("placeNavUrl", "");
        String plabel = data.optString("placeLabel", "");
        if (!phone.isEmpty() || !navUrl.isEmpty()) {
            LinearLayout extra = new LinearLayout(this);
            extra.setOrientation(LinearLayout.HORIZONTAL);
            extra.setPadding(0, dp(12), 0, 0);
            boolean both = !phone.isEmpty() && !navUrl.isEmpty();
            if (!phone.isEmpty()) {
                Button call = button("📞 Appeler" + (cname.isEmpty() || both ? "" : " " + cname), soft, fg);
                call.setOnClickListener(v -> stopAndLaunch(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.replaceAll("[^0-9+]", "")))));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                if (both) lp.setMargins(0, 0, dp(6), 0);
                extra.addView(call, lp);
            }
            if (!navUrl.isEmpty()) {
                Button go = button("📍 Itinéraire" + (plabel.isEmpty() || both ? "" : " · " + plabel), soft, fg);
                go.setOnClickListener(v -> stopAndLaunch(new Intent(Intent.ACTION_VIEW, Uri.parse(navUrl))));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                if (both) lp.setMargins(dp(6), 0, 0, 0);
                extra.addView(go, lp);
            }
            root.addView(extra);
        }

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(10), 0, dp(10));
        int btnBg = isLight(color) ? Color.parseColor("#111111") : Color.WHITE;
        int btnFg = isLight(color) ? Color.WHITE : Color.parseColor("#111111");

        Button snooze = button("Snooze " + AlarmStore.snoozeMinutes(this) + " min", soft, fg);
        Button details = button("Détails", soft, fg);
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        half.setMargins(0, 0, dp(6), 0);
        LinearLayout.LayoutParams half2 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        half2.setMargins(dp(6), 0, 0, 0);
        row.addView(snooze, half);
        row.addView(details, half2);
        root.addView(row);

        Button stop = button("Arrêter", btnBg, btnFg);
        stop.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        stop.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(stop, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(68)));

        stop.setOnClickListener(v -> {
            sendToService(AlarmService.ACTION_STOP);
            finish();
        });
        snooze.setOnClickListener(v -> {
            sendToService(AlarmService.ACTION_SNOOZE);
            finish();
        });
        details.setOnClickListener(v -> {
            Intent i = new Intent(this, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (!alarmId.isEmpty()) i.putExtra("openAlarm", alarmId);
            stopAndLaunch(i);
        });

        setContentView(root);
    }

    private void sendToService(String action) {
        Intent i = new Intent(this, AlarmService.class).setAction(action).putExtra("nid", nid);
        if (json != null) i.putExtra("json", json);
        try {
            startService(i);
        } catch (Exception e) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.cancel(nid);
            if (AlarmService.ACTION_SNOOZE.equals(action)) AlarmReceiver.snooze(this, nid, json, 0);
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(nid);
    }

    /** Arrête la sonnerie, déverrouille si besoin, puis ouvre l'appli demandée. */
    private void stopAndLaunch(Intent target) {
        launching = true;
        sendToService(AlarmService.ACTION_STOP);
        target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Runnable go = () -> {
            try {
                startActivity(target);
            } catch (Exception ignored) {}
            finish();
        };
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    go.run();
                }

                @Override
                public void onDismissCancelled() {
                    launching = false;
                    finish();
                }

                @Override
                public void onDismissError() {
                    launching = false;
                    finish();
                }
            });
        } else {
            go.run();
        }
    }
}
