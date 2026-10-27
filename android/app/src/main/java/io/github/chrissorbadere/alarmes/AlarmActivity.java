package io.github.chrissorbadere.alarmes;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/** Écran plein qui s'affiche quand une alarme sonne, même téléphone verrouillé. */
public class AlarmActivity extends Activity {
    private int nid;
    private String json;
    private JSONObject data;

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
        try {
            data = json != null ? new JSONObject(json) : new JSONObject();
        } catch (Exception e) {
            data = new JSONObject();
        }
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
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTextColor(fg);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(16));
        b.setBackground(d);
        b.setPadding(dp(12), dp(14), dp(12), dp(14));
        return b;
    }

    private void build() {
        int color = AlarmReceiver.parseColor(data.optString("color", "#2563eb"));
        int fg = isLight(color) ? Color.parseColor("#111111") : Color.WHITE;
        int soft = isLight(color) ? Color.argb(40, 0, 0, 0) : Color.argb(50, 255, 255, 255);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color);
        root.setPadding(dp(24), dp(48), dp(24), dp(28));

        TextView time = new TextView(this);
        time.setText(new SimpleDateFormat("HH:mm", Locale.FRANCE).format(new Date()));
        time.setTextSize(TypedValue.COMPLEX_UNIT_SP, 64);
        time.setTypeface(Typeface.DEFAULT_BOLD);
        time.setTextColor(fg);
        time.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(time);

        String tag = data.optString("levelLabel", "");
        if (!tag.isEmpty()) {
            TextView lvl = new TextView(this);
            lvl.setText(tag.toUpperCase(Locale.FRANCE));
            lvl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            lvl.setLetterSpacing(0.15f);
            lvl.setTextColor(fg);
            lvl.setGravity(Gravity.CENTER_HORIZONTAL);
            lvl.setPadding(0, dp(4), 0, 0);
            root.addView(lvl);
        }

        TextView title = new TextView(this);
        title.setText(data.optString("title", "Alarme"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(fg);
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        title.setPadding(0, dp(18), 0, dp(14));
        root.addView(title);

        ScrollView sv = new ScrollView(this);
        GradientDrawable box = new GradientDrawable();
        box.setColor(soft);
        box.setCornerRadius(dp(16));
        sv.setBackground(box);
        TextView body = new TextView(this);
        String txt = data.optString("body", "");
        body.setText(txt.isEmpty() ? "(pas de description)" : txt);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        body.setLineSpacing(0, 1.2f);
        body.setTextColor(fg);
        body.setPadding(dp(16), dp(14), dp(16), dp(14));
        sv.addView(body);
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        if (data.optBoolean("hasExtras", false)) {
            TextView hint = new TextView(this);
            hint.setText("Photo, contact ou lieu joints : touche « Détails »");
            hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            hint.setTextColor(fg);
            hint.setGravity(Gravity.CENTER_HORIZONTAL);
            hint.setPadding(0, dp(10), 0, 0);
            root.addView(hint);
        }

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(18), 0, dp(10));
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
        root.addView(stop, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)));

        stop.setOnClickListener(v -> {
            cancelNotif();
            finish();
        });
        snooze.setOnClickListener(v -> {
            cancelNotif();
            AlarmReceiver.snooze(this, nid, json);
            finish();
        });
        details.setOnClickListener(v -> openDetails());

        setContentView(root);
    }

    private void cancelNotif() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(nid);
    }

    private void openDetails() {
        cancelNotif();
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        String id = data.optString("alarmId", "");
        if (!id.isEmpty()) i.putExtra("openAlarm", id);
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    startActivity(i);
                    finish();
                }
            });
        } else {
            startActivity(i);
            finish();
        }
    }
}
