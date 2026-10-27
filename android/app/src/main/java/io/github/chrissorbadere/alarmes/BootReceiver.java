package io.github.chrissorbadere.alarmes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        AlarmStore.ensureChannels(c);
        AlarmStore.rescheduleStored(c);
    }
}
