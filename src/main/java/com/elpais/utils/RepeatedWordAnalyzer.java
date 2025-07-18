package com.elpais.utils;

import java.util.*;

public class RepeatedWordAnalyzer {

    public static Map<String, Integer> findRepeatedWords(List<String> translatedHeaders) {
        Map<String, Integer> wordCount = new HashMap<>();

        for (String header : translatedHeaders) {
            String[] words = header.toLowerCase()
                    .replaceAll("[^a-zA-Z ]", "")
                    .split("\\s+");

            for (String word : words) {
                if (word.length() > 2) { // Ignore short/common words like "is", "an"
                    wordCount.put(word, wordCount.getOrDefault(word, 0) + 1);
                }
            }
        }

        // Keep only words that appear more than twice
        Map<String, Integer> repeated = new LinkedHashMap<>();
        for (Map.Entry<String, Integer> entry : wordCount.entrySet()) {
            if (entry.getValue() > 2) {
                repeated.put(entry.getKey(), entry.getValue());
            }
        }

        return repeated;
    }
}
