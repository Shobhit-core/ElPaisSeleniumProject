package com.elpais.utils;

import com.elpais.config.ConfigReader;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class Translator {

    private static final String API_KEY = ConfigReader.get("rapidapi.key");
    private static final String API_HOST = "free-google-translator.p.rapidapi.com";
    private static final String ENDPOINT_BASE = "https://free-google-translator.p.rapidapi.com/external-api/free-google-translator";

    public static String translateFromSpanishToEnglish(String text) {
        try {
            String encodedText = URLEncoder.encode(text, StandardCharsets.UTF_8.toString());

            String urlStr = ENDPOINT_BASE + "?from=es&to=en&query=" + encodedText;
            URL url = new URL(urlStr);

            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("x-rapidapi-key", API_KEY);
            conn.setRequestProperty("x-rapidapi-host", API_HOST);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            String requestBody = "{\"translate\":\"rapidapi\"}";

            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = requestBody.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int responseCode = conn.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                    StringBuilder errorResp = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        errorResp.append(line.trim());
                    }
                    System.err.println("Translation API error response: " + errorResp.toString());
                }
                return "Translation Error";
            }

            StringBuilder response = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    response.append(line.trim());
                }
            }

            String respStr = response.toString();

            // Locate "translatedText":"..."" value
            String key = "\"translation\":\"";
            int startIdx = respStr.indexOf(key);
            if (startIdx == -1) return "Translation Error";

            startIdx += key.length();
            int endIdx = respStr.indexOf("\"", startIdx);
            if (endIdx == -1) return "Translation Error";

            String translatedText = respStr.substring(startIdx, endIdx);
            return translatedText;

        } catch (Exception e) {
            e.printStackTrace();
            return "Translation Error";
        }
    }

    public static String unescapeUnicode(String escaped) {
        StringBuilder sb = new StringBuilder();
        int i = 0;
        while (i < escaped.length()) {
            char c = escaped.charAt(i++);
            if (c == '\\' && i < escaped.length()) {
                char next = escaped.charAt(i++);
                if (next == 'u' && i + 4 <= escaped.length()) {
                    String hex = escaped.substring(i, i + 4);
                    i += 4;
                    try {
                        int code = Integer.parseInt(hex, 16);
                        sb.append((char) code);
                    } catch (NumberFormatException e) {
                        sb.append("\\u").append(hex); // fallback
                    }
                } else {
                    sb.append(c).append(next);
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

}