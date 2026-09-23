package kr.mealzip.collective;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

public final class CollectiveLauncherActivity extends LauncherActivity {
    private static final String START_URL = "https://mealzip-agency.hflameb.chatgpt.site/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setIntent(launcherIntent(getIntent()).setComponent(getComponentName()));
        super.onCreate(savedInstanceState);
    }

    static Intent launcherIntent(Intent incoming) {
        // Keep ABH task handling, but never forward external data, grants or share payloads.
        int taskFlags = incoming.getFlags()
                & (Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
        return new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setFlags(taskFlags);
    }

    @Override
    protected Uri getLaunchingUrl() {
        return Uri.parse(START_URL);
    }

    @Override
    protected Uri getUrlForIntent(Intent intent) {
        return null;
    }
}
