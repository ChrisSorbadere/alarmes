package io.github.chrissorbadere.alarmes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
