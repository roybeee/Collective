package kr.mealzip.collective;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.content.Intent;
import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class CollectiveLauncherActivityTest {
    @Test
    public void launcherAlwaysOpensProductionSite() {
        CollectiveLauncherActivity activity = new CollectiveLauncherActivity();
        assertEquals("https://mealzip-agency.hflameb.chatgpt.site/",
                activity.getLaunchingUrl().toString());
    }

    @Test
    public void ignoresExternalHttpsIntent() {
        assertIgnored("https://attacker.example/phishing");
    }

    @Test
    public void ignoresPlainHttpIntent() {
        assertIgnored("http://mealzip-agency.hflameb.chatgpt.site/");
    }

    @Test
    public void ignoresFileIntent() {
        assertIgnored("content://attacker.example/private");
    }

    @Test
    public void ignoresJavascriptIntent() {
        assertIgnored("javascript:alert(1)");
    }

    @Test
    public void ignoresSameOriginUntrustedPath() {
        assertIgnored("https://mealzip-agency.hflameb.chatgpt.site/?redirect=https://attacker.example");
    }

    @Test
    public void acceptsLauncherWithNoData() {
        assertNull(new CollectiveLauncherActivity().getUrlForIntent(new Intent(Intent.ACTION_MAIN)));
    }

    @Test
    public void dropsInboundFileAndSharePayloads() {
        Intent incoming = new Intent(Intent.ACTION_SEND, Uri.parse("content://attacker.example/private"))
                .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://attacker.example/secret"));
        assertNull(CollectiveLauncherActivity.launcherIntent(incoming).getExtras());
    }

    @Test
    public void dropsInboundIntentData() {
        Intent incoming = new Intent(Intent.ACTION_VIEW, Uri.parse("https://attacker.example/"));
        assertNull(CollectiveLauncherActivity.launcherIntent(incoming).getData());
    }

    @Test
    public void preservesTaskFlagForBrowserBackStack() {
        Intent incoming = new Intent(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK,
                CollectiveLauncherActivity.launcherIntent(incoming).getFlags());
    }

    @Test
    public void dropsUriPermissionFlags() {
        Intent incoming = new Intent(Intent.ACTION_VIEW).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        assertEquals(0, CollectiveLauncherActivity.launcherIntent(incoming).getFlags());
    }

    @Test
    public void doesNotMutateIncomingIntent() {
        Intent incoming = new Intent(Intent.ACTION_VIEW, Uri.parse("https://attacker.example/"));
        CollectiveLauncherActivity.launcherIntent(incoming);
        assertEquals("https://attacker.example/", incoming.getData().toString());
    }

    private void assertIgnored(String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        assertNull(new CollectiveLauncherActivity().getUrlForIntent(intent));
    }
}
