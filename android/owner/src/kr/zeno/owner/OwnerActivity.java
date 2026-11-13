package kr.zeno.owner;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
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
    private static final int SURFACE = Color.rgb(248, 250, 252);
    private WebView web;
    private LinearLayout offline;
    private ValueCallback<Uri[]> pendingPhoto;
    private boolean pageFailed = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(SURFACE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(SURFACE);
        // Android 15+ enforces edge-to-edge. Keep content outside system bars, including gesture area.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        web = new WebView(this);
        web.setBackgroundColor(SURFACE);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (isOwnerUrl(uri)) return false;
                if (request.hasGesture()) openExternal(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pageFailed = false;
                offline.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    offline.setVisibility(View.VISIBLE);
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                                       android.webkit.WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                    pageFailed = true;
                    offline.setVisibility(View.VISIBLE);
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!pageFailed) offline.setVisibility(View.GONE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result,
                                                        FileChooserParams params) {
                if (pendingPhoto != null) pendingPhoto.onReceiveValue(null);
                pendingPhoto = result;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*")
                        .addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, PHOTO); }
                catch (ActivityNotFoundException e) { finishPhoto(null); }
                return true;
            }
            // External maps, hospital sites and photo sources often use target="_blank".
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                                     Message resultMsg) {
                if (!isUserGesture) return false;
                WebView popup = new WebView(OwnerActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled = false;
                    private void handle(WebView target, Uri uri) {
                        if (handled) return;
                        handled = true;
                        if (isOwnerUrl(uri)) web.loadUrl(uri.toString());
                        else openExternal(uri);
                        target.post(target::destroy);
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        handle(v, r.getUrl());
                        return true;
                    }
                    @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                        handle(v, Uri.parse(url));
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });

        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setPadding(30, 30, 30, 30);
        offline.setBackgroundColor(SURFACE);
        TextView message = new TextView(this);
        message.setText("제노에 연결할 수 없어요.\n인터넷 연결을 확인해 주세요.");
        message.setTextSize(15);
        message.setTextColor(Color.rgb(48, 67, 86));
        message.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText("다시 연결");
        retry.setOnClickListener(v -> {
            pageFailed = false;
            offline.setVisibility(View.GONE);
            web.loadUrl(HOME);
        });
        offline.addView(message);
        offline.addView(retry);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        offline.setVisibility(View.GONE);
        setContentView(root);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private boolean isOwnerUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if ("tel".equalsIgnoreCase(scheme)) open(new Intent(Intent.ACTION_DIAL, uri));
        else if ("https".equalsIgnoreCase(scheme)) open(new Intent(Intent.ACTION_VIEW, uri));
    }

    private void open(Intent intent) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException e) {
            Toast.makeText(this, "연결할 앱이 없어요.", Toast.LENGTH_SHORT).show();
        }
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
        if (web != null) web.saveState(out);
    }

    @Override public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) {
            offline.setVisibility(View.GONE);
            super.onBackPressed();
            return;
        }
        // In-page modal and section navigation do not always create a native WebView entry.
        web.evaluateJavascript("(function(){try{if(typeof state!=='undefined'&&state.modal){zenoCloseModal();return true;}if(typeof state!=='undefined'&&state.page!=='home'&&state.page!=='login'){if(history.state&&history.state.zenoPage){history.back();}else{navTo('home');}return true;}}catch(e){}return false;})()", result -> {
            if ("true".equals(result)) return;
            if (web.canGoBack()) web.goBack();
            else OwnerActivity.super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        finishPhoto(null);
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }
}
