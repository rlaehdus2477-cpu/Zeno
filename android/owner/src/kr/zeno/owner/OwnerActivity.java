package kr.zeno.owner;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class OwnerActivity extends Activity {
    private static final String HOST = "zeno.rlaehdus2477.workers.dev";
    private static final String HOME = "https://" + HOST + "/owner";
    private static final int PHOTO = 1;
    private WebView web;
    private LinearLayout offline;
    private ValueCallback<Uri[]> pendingPhoto;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setStatusBarColor(Color.WHITE);
        web = new WebView(this);
        root.addView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if ("https".equals(scheme) && HOST.equals(url.getEncodedAuthority())) return false;
                if (!request.hasGesture()) return true;
                if ("tel".equals(scheme)) open(new Intent(Intent.ACTION_DIAL, url));
                else if ("https".equals(scheme)) open(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame()) offline.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result, FileChooserParams params) {
                if (pendingPhoto != null) pendingPhoto.onReceiveValue(null);
                pendingPhoto = result;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*")
                        .addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, PHOTO); }
                catch (ActivityNotFoundException e) { finishPhoto(null); }
                return true;
            }
        });
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(Color.WHITE);
        TextView message = new TextView(this);
        message.setText("제노에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.");
        message.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText("다시 연결");
        retry.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.loadUrl(HOME); });
        offline.addView(message);
        offline.addView(retry);
        root.addView(offline);
        offline.setVisibility(View.GONE);
        setContentView(root);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private void open(Intent intent) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "연결할 앱이 없어요.", Toast.LENGTH_SHORT).show(); }
    }

    private void finishPhoto(Uri uri) {
        if (pendingPhoto == null) return;
        pendingPhoto.onReceiveValue(uri == null ? null : new Uri[]{uri});
        pendingPhoto = null;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PHOTO) return;
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        finishPhoto(uri != null && "content".equals(uri.getScheme()) ? uri : null);
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override public void onBackPressed() {
        if (offline.getVisibility() == View.GONE && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        finishPhoto(null);
        web.destroy();
        super.onDestroy();
    }
}
