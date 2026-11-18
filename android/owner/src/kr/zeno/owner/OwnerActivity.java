package kr.zeno.owner;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.location.Address;
import android.location.Geocoder;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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
    private static final String HOME = "https://" + HOST + "/owner?android_app=1.3";
    private static final int PHOTO = 1;
    private static final int GEO_PERMISSION = 42;
    private final ExecutorService geocoderPool = Executors.newSingleThreadExecutor();
    private GeolocationPermissions.Callback pendingGeolocation;
    private String pendingGeolocationOrigin;
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
        settings.setGeolocationEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDefaultTextEncodingName("UTF-8");
        // The live ZENO UI is served by Cloudflare. Never reuse an obsolete WebView HTTP cache.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.clearCache(true);
        // Only our HTTPS origin is allowed in this WebView. The bridge never receives
        // the pet owner's GPS: Android geocodes already-listed clinic addresses only.
        web.addJavascriptInterface(new NearbyHospitalGeocoder(), "ZenoNearbyAndroid");
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
            @Override public void onGeolocationPermissionsShowPrompt(String origin,
                                                                     GeolocationPermissions.Callback callback) {
                if (!("https://" + HOST).equalsIgnoreCase(origin)) {
                    callback.invoke(origin, false, false);
                    return;
                }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeolocation = callback;
                pendingGeolocationOrigin = origin;
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                }, GEO_PERMISSION);
            }

            @Override public void onGeolocationPermissionsHidePrompt() {
                // Android permission result is resolved by onRequestPermissionsResult.
            }
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

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != GEO_PERMISSION || pendingGeolocation == null) return;
        boolean allowed = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        pendingGeolocation.invoke(pendingGeolocationOrigin, allowed, false);
        pendingGeolocation = null;
        pendingGeolocationOrigin = null;
    }

    private void reportNativeCoordinates(JSONObject data) {
        if (web == null || !isOwnerUrl(Uri.parse(web.getUrl()))) return;
        String encoded = JSONObject.quote(data.toString());
        web.post(() -> {
            if (web != null && isOwnerUrl(Uri.parse(web.getUrl()))) {
                web.evaluateJavascript("window.zenoNearbyAndroidReport && window.zenoNearbyAndroidReport(" + encoded + ")", null);
            }
        });
    }

    // Geocode only the existing hospital addresses supplied by our own ZENO page.
    // No device GPS coordinates are ever passed to this bridge or a remote server.
    private final class NearbyHospitalGeocoder {
        @JavascriptInterface
        public void resolveHospitalAddresses(String data) {
            if (web == null || !isOwnerUrl(Uri.parse(web.getUrl()))) return;
            if (data == null || data.length() > 20000) return;
            geocoderPool.execute(() -> {
                try {
                    JSONArray rows = new JSONArray(data);
                    if (rows.length() < 1 || rows.length() > 100) throw new Exception("병원 주소 목록을 확인해 주세요.");
                    if (!Geocoder.isPresent()) throw new Exception("휴대폰 주소 위치 변환 서비스를 사용할 수 없습니다.");
                    Geocoder coder = new Geocoder(OwnerActivity.this, Locale.KOREA);
                    SharedPreferences cache = getSharedPreferences("zeno_hospital_geo_v1", MODE_PRIVATE);
                    JSONObject locations = new JSONObject();
                    int missing = 0;
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject row = rows.optJSONObject(i);
                        String id = row == null ? "" : row.optString("id", "");
                        String address = row == null ? "" : row.optString("address", "").trim();
                        if (!id.matches("[a-zA-Z0-9_-]{1,40}") || !address.contains("청주") || address.length() > 200) {
                            missing++;
                            continue;
                        }
                        String key = id + "|" + address;
                        String saved = cache.getString(key, "");
                        double lat = Double.NaN, lon = Double.NaN;
                        if (!saved.isEmpty()) {
                            try {
                                String[] parts = saved.split(",");
                                lat = Double.parseDouble(parts[0]);
                                lon = Double.parseDouble(parts[1]);
                            } catch (Exception ignored) {}
                        }
                        if (!Double.isFinite(lat) || !Double.isFinite(lon)) {
                            String query = address.replaceAll("\\s*\\([^)]*\\).*", "").trim();
                            try {
                                List<Address> found = coder.getFromLocationName(query, 1, 35.9, 126.9, 37.0, 128.2);
                                if (found != null && !found.isEmpty()) {
                                    lat = found.get(0).getLatitude();
                                    lon = found.get(0).getLongitude();
                                }
                            } catch (Exception ignored) { /* Do not guess a location. */ }
                        }
                        if (Double.isFinite(lat) && Double.isFinite(lon)
                                && lat > 35.9 && lat < 37.0 && lon > 126.9 && lon < 128.2) {
                            JSONObject position = new JSONObject();
                            position.put("lat", lat);
                            position.put("lon", lon);
                            locations.put(id, position);
                            if (saved.isEmpty()) cache.edit().putString(key, lat + "," + lon).apply();
                        } else {
                            missing++;
                        }
                        if ((i + 1) % 5 == 0 || i + 1 == rows.length()) {
                            JSONObject progress = new JSONObject();
                            progress.put("coordinates", locations);
                            progress.put("processed", i + 1);
                            progress.put("total", rows.length());
                            progress.put("missing", missing);
                            progress.put("done", i + 1 == rows.length());
                            reportNativeCoordinates(progress);
                        }
                    }
                } catch (Exception error) {
                    try {
                        JSONObject fail = new JSONObject();
                        fail.put("error", error.getMessage() == null ? "주소 좌표 확인에 실패했습니다." : error.getMessage());
                        reportNativeCoordinates(fail);
                    } catch (Exception ignored) {}
                }
            });
        }
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
        geocoderPool.shutdownNow();
        if (pendingGeolocation != null) {
            pendingGeolocation.invoke(pendingGeolocationOrigin, false, false);
            pendingGeolocation = null;
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }
}
