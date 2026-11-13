package com.lowbudgetatheon.wfrelics;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A thin shell around the web app in assets/www. Pages load from
 * https://appassets.androidplatform.net so browser storage and fetch work
 * normally. The "WRC" bridge adds clipboard copy, a fetch for hosts that don't
 * send CORS headers, and status bar colors that follow the theme.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final Set<String> FETCH_HOSTS = new HashSet<>(Arrays.asList(
            "api.warframestat.us", "content.warframe.com", "raw.githubusercontent.com"));

    private static final int PICK_FILE = 42;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0f14"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false); // the secret sound plays without a tap

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true; // outside links (wiki pages) open in the phone's browser
            }
        });
        // Lets <input type="file"> open the phone's file picker (used for the secret sound)
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "WRC");
        web.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> updateGestureExclusion());

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
    }

    /** Lets a swipe from the middle of either edge open a side panel instead of Android's back gesture. */
    private void updateGestureExclusion() {
        if (Build.VERSION.SDK_INT < 29) return;
        float d = getResources().getDisplayMetrics().density;
        int h = web.getHeight();
        int band = (int) (200 * d);
        int w = (int) (20 * d);
        int top = Math.max(0, h / 2 - band / 2);
        int right = web.getWidth();
        web.setSystemGestureExclusionRects(Arrays.asList(
                new Rect(0, top, w, top + band),               // left edge: settings menu
                new Rect(right - w, top, right, top + band)));  // right edge: checklist
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.wrcBack && window.wrcBack()) === true", v -> {
            if (!"true".equals(v)) leave();
        });
    }

    private void leave() {
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        return o.toString("UTF-8");
    }

    class Bridge {
        @JavascriptInterface
        public void copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Warframe Relic Companion", text));
        }

        @JavascriptInterface
        public void httpGet(final String url, final String id) {
            pool.execute(() -> {
                boolean ok = false;
                String body;
                try {
                    Uri u = Uri.parse(url);
                    if (!"https".equals(u.getScheme()) || !FETCH_HOSTS.contains(u.getHost()))
                        throw new IOException("host not allowed");
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setRequestProperty("User-Agent", "WarframeRelicCompanion");
                    int code = c.getResponseCode();
                    if (code != 200) throw new IOException("HTTP " + code);
                    try (InputStream in = c.getInputStream()) {
                        body = readAll(in);
                    }
                    ok = true;
                } catch (Exception e) {
                    body = String.valueOf(e.getMessage());
                }
                final String js = "window.__wrcHttp(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(body) + ")";
                ui.post(() -> web.evaluateJavascript(js, null));
            });
        }

        /** Plays a vibration pattern: comma-separated off/on times in milliseconds. */
        @JavascriptInterface
        public void vibrate(String pattern) {
            try {
                String[] parts = pattern.split(",");
                long[] t = new long[parts.length];
                for (int i = 0; i < parts.length; i++) t[i] = Long.parseLong(parts[i].trim());
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createWaveform(t, -1));
            } catch (Exception ignored) {
            }
        }

        /** True when the phone is on silent or vibrate, so the secret sound stays quiet. */
        @JavascriptInterface
        public boolean isSilent() {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            return am != null && am.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        }

        @JavascriptInterface
        public void setBarColor(final String hex, final boolean light) {
            ui.post(() -> {
                try {
                    int c = Color.parseColor(hex);
                    Window w = getWindow();
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                    web.setBackgroundColor(c);
                    View dv = w.getDecorView();
                    int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    int f = dv.getSystemUiVisibility();
                    dv.setSystemUiVisibility(light ? (f | lightFlags) : (f & ~lightFlags));
                } catch (Exception ignored) {
                }
            });
        }
    }
}
