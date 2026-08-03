package eu.lielu.news;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Avant super.onCreate : c'est lui qui construit le pont et fige la liste
        // des plugins exposés à la WebView.
        registerPlugin(InAppBrowserPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
