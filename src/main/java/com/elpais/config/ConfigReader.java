package com.elpais.config;

import java.io.FileInputStream;
import java.util.Properties;

public class ConfigReader {
    private static final Properties props = new Properties();

    public static void load(String path) throws Exception {
        FileInputStream fis = new FileInputStream(path);
        props.load(fis);
    }

    public static String get(String key) {
        return props.getProperty(key);
    }

    public static int getInt(String key) {
        return Integer.parseInt(props.getProperty(key));
    }

    public static String[] getArray(String key) {
        return props.getProperty(key).split(",");
    }

    // For BrowserStack capability keys (like bs1.browser, bs1.os)
    public static String getCapability(String key) {
        return props.getProperty(key);
    }

    // To decide local or remote
    public static String getRunMode() {
        String mode = props.getProperty("browser");
        return mode != null && mode.equalsIgnoreCase("browserstack") ? "browserstack" : "local";
    }
}
