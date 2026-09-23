package kr.mealzip.collective;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class BrowserManifestTest {
    @Test
    public void browserStartupCanResolveManageDataActivity() throws Exception {
        ActivityInfo info = manageDataActivity();
        assertEquals(ManageDataLauncherActivity.class.getName(), info.name);
    }

    @Test
    public void dataManagementUsesProductionOrigin() throws Exception {
        assertEquals("https://mealzip-agency.hflameb.chatgpt.site/",
                manageDataActivity().metaData.getString(
                        "android.support.customtabs.trusted.MANAGE_SPACE_URL"));
    }

    @Test
    public void dataManagementIsNotAnExternalEntryPoint() throws Exception {
        assertFalse(manageDataActivity().exported);
    }

    @Test
    public void androidAppSettingsUsesRegisteredDataManagementActivity() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        assertEquals(ManageDataLauncherActivity.class.getName(),
                context.getPackageManager().getApplicationInfo(context.getPackageName(), 0)
                        .manageSpaceActivityName);
    }

    private ActivityInfo manageDataActivity() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        return context.getPackageManager().getActivityInfo(
                new ComponentName(context, ManageDataLauncherActivity.class),
                PackageManager.GET_META_DATA);
    }
}
