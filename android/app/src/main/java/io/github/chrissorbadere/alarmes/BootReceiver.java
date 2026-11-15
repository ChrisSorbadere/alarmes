package io.github.chrissorbadere.alarmes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        AlarmStore.ensureChannels(c);
        int n = AlarmStore.rescheduleStored(c);
        String act = intent.getAction() == null ? "?" : intent.getAction();
        String why = act.endsWith("BOOT_COMPLETED") || act.endsWith("QUICKBOOT_POWERON") ? "Téléphone redémarré"
            : act.endsWith("PACKAGE_REPLACED") ? "Appli mise à jour"
            : act.endsWith("TIME_SET") ? "Heure du téléphone modifiée"
            : act.endsWith("TIMEZONE_CHANGED") ? "Fuseau horaire modifié" : "Autorisation modifiée";
        AlarmStore.log(c, why + " : " + n + " alarme(s) reprogrammée(s)");
    }
}
