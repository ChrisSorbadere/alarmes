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
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
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
        if (savedInstanceState == null) AlarmStore.log(this, "Écran d'alarme affiché");
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
        b.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 17);
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
        String alarmId = data.optString("alarmId", "");
        int photoCount = data.optInt("photoCount", 0);

        // Fond : première photo floutée si elle existe, sinon la couleur de l'alarme
        Bitmap bgBm = null;
        if (photoCount > 0 && !alarmId.isEmpty()) bgBm = loadPhoto(photoFile(this, alarmId, 0), 64);
        boolean photoBg = bgBm != null;
        int fg = photoBg ? Color.WHITE : (isLight(color) ? Color.parseColor("#111111") : Color.WHITE);
        int soft = photoBg ? Color.argb(56, 255, 255, 255) : (isLight(color) ? Color.argb(40, 0, 0, 0) : Color.argb(50, 255, 255, 255));

        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(photoBg ? Color.BLACK : color);
        if (photoBg) {
            ImageView bg = new ImageView(this);
            bg.setImageBitmap(bgBm);
            bg.setScaleType(ImageView.ScaleType.CENTER_CROP);
            if (Build.VERSION.SDK_INT >= 31) {
                try {
                    bg.setRenderEffect(android.graphics.RenderEffect.createBlurEffect(dp(18), dp(18), android.graphics.Shader.TileMode.CLAMP));
                } catch (Exception ignored) {}
            }
            frame.addView(bg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            View scrim = new View(this);
            scrim.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { Color.argb(120, 0, 0, 0), Color.argb(175, 0, 0, 0), Color.argb(225, 0, 0, 0) }));
            frame.addView(scrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        // Écran = zone défilante (heure, titre, photos, description) + panneau du bas TOUJOURS visible (reporter, Arrêter)
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        frame.addView(outer, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ScrollView topScroll = new ScrollView(this);
        topScroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        topScroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        outer.addView(topScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        outer.addView(bottom, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.setPadding(dp(22), dp(28), dp(22), dp(8));
        bottom.setPadding(dp(22), 0, dp(22), dp(16));
        outer.setOnApplyWindowInsetsListener((v, insets) -> {
            root.setPadding(dp(22), dp(20) + insets.getSystemWindowInsetTop(), dp(22), dp(8));
            bottom.setPadding(dp(22), 0, dp(22), dp(12) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        // taille limitée : les grands caractères du téléphone ne doivent pas pousser les boutons hors de l'écran
        float fs = Math.min(1.15f, getResources().getConfiguration().fontScale);

        Date nowD = new Date();
        TextView time = new TextView(this);
        time.setText(new SimpleDateFormat("HH:mm", Locale.FRANCE).format(nowD));
        time.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 68);
        time.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        time.setTextColor(fg);
        time.setGravity(Gravity.CENTER_HORIZONTAL);
        time.setIncludeFontPadding(false);
        root.addView(time);

        TextView day = new TextView(this);
        day.setText(new SimpleDateFormat("EEEE d MMMM", Locale.FRANCE).format(nowD));
        day.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15 * fs);
        day.setTextColor(fg);
        day.setAlpha(0.8f);
        day.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(day);

        String tag = data.optString("levelLabel", "");
        if (!tag.isEmpty()) {
            TextView lvl = new TextView(this);
            lvl.setText(tag.toUpperCase(Locale.FRANCE));
            lvl.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
            lvl.setLetterSpacing(0.15f);
            lvl.setTypeface(Typeface.DEFAULT_BOLD);
            GradientDrawable pill = new GradientDrawable();
            pill.setCornerRadius(dp(99));
            pill.setColor(photoBg ? color : soft);
            lvl.setBackground(pill);
            lvl.setTextColor(photoBg ? (isLight(color) ? Color.parseColor("#111111") : Color.WHITE) : fg);
            lvl.setPadding(dp(12), dp(4), dp(12), dp(4));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.gravity = Gravity.CENTER_HORIZONTAL;
            lp.setMargins(0, dp(12), 0, 0);
            root.addView(lvl, lp);
        }

        TextView title = new TextView(this);
        title.setText(data.optString("title", "Alarme"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 26 * fs);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(fg);
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        title.setMaxLines(3);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setPadding(0, dp(12), 0, dp(14));
        root.addView(title);

        // Photos jointes
        if (photoCount > 0 && !alarmId.isEmpty()) {
            HorizontalScrollView hs = new HorizontalScrollView(this);
            hs.setHorizontalScrollBarEnabled(false);
            LinearLayout strip = new LinearLayout(this);
            strip.setOrientation(LinearLayout.HORIZONTAL);
            int h = dp(photoCount == 1 ? 170 : 130);
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
                bg.setCornerRadius(dp(18));
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
                LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, h);
                sp.setMargins(0, 0, 0, dp(12));
                if (photoCount == 1) {
                    root.addView(strip, sp);
                } else {
                    hs.addView(strip);
                    root.addView(hs, sp);
                }
            }
        }

        // Description, lisible de loin
        String txt = data.optString("body", "");
        if (!txt.isEmpty()) {
            GradientDrawable box = new GradientDrawable();
            box.setColor(soft);
            box.setCornerRadius(dp(18));
            TextView body = new TextView(this);
            body.setBackground(box);
            body.setText(txt);
            body.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 19 * fs);
            body.setLineSpacing(0, 1.25f);
            body.setTextColor(fg);
            body.setPadding(dp(18), dp(14), dp(18), dp(14));
            root.addView(body, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        }

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

        // Reporter : durée au choix
        TextView later = new TextView(this);
        later.setText("Reporter de");
        later.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13 * fs);
        later.setTextColor(fg);
        later.setAlpha(0.8f);
        later.setPadding(dp(4), dp(10), 0, dp(6));
        bottom.addView(later);

        java.util.TreeSet<Integer> choices = new java.util.TreeSet<>(java.util.Arrays.asList(5, 10, 30, 60));
        int def = AlarmStore.snoozeMinutes(this);
        choices.add(def);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int k = 0;
        for (int min : choices) {
            Button sb = button(min >= 60 ? (min / 60) + " h" + (min % 60 > 0 ? " " + (min % 60) : "") : min + " min", soft, fg);
            sb.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 16);
            if (Build.VERSION.SDK_INT >= 26) sb.setAutoSizeTextTypeUniformWithConfiguration(10, 16, 1, TypedValue.COMPLEX_UNIT_DIP);
            if (min == def) sb.setTypeface(Typeface.DEFAULT_BOLD);
            sb.setPadding(dp(2), dp(12), dp(2), dp(12));
            sb.setMinHeight(dp(52));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            if (k++ > 0) lp.setMargins(dp(8), 0, 0, 0);
            final int fmin = min;
            sb.setOnClickListener(v -> {
                sendToService(AlarmService.ACTION_SNOOZE, fmin);
                finish();
            });
            row.addView(sb, lp);
        }
        bottom.addView(row);

        int btnBg = photoBg ? Color.WHITE : (isLight(color) ? Color.parseColor("#111111") : Color.WHITE);
        int btnFg = photoBg ? Color.parseColor("#111111") : (isLight(color) ? Color.WHITE : Color.parseColor("#111111"));
        Button stop = button("Arrêter", btnBg, btnFg);
        stop.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24);
        stop.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76));
        stopLp.setMargins(0, dp(12), 0, 0);
        bottom.addView(stop, stopLp);

        TextView details = new TextView(this);
        details.setText("Voir les détails dans l'appli ›");
        details.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14 * fs);
        details.setTextColor(fg);
        details.setAlpha(0.85f);
        details.setGravity(Gravity.CENTER_HORIZONTAL);
        details.setPadding(0, dp(12), 0, dp(2));
        bottom.addView(details);

        stop.setOnClickListener(v -> {
            sendToService(AlarmService.ACTION_STOP, 0);
            finish();
        });
        details.setOnClickListener(v -> {
            Intent i = new Intent(this, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (!alarmId.isEmpty()) i.putExtra("openAlarm", alarmId);
            stopAndLaunch(i);
        });

        setContentView(frame);
    }

    private void sendToService(String action) {
        sendToService(action, 0);
    }

    private void sendToService(String action, int minutes) {
        Intent i = new Intent(this, AlarmService.class).setAction(action).putExtra("nid", nid);
        if (minutes > 0) i.putExtra("minutes", minutes);
        if (json != null) i.putExtra("json", json);
        try {
            startService(i);
        } catch (Exception e) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.cancel(nid);
            if (AlarmService.ACTION_SNOOZE.equals(action)) AlarmReceiver.snooze(this, nid, json, 0, minutes);
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
