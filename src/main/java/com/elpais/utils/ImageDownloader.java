package com.elpais.utils;

import org.apache.commons.io.FileUtils;

import java.io.File;
import java.net.URL;
import java.util.List;

public class ImageDownloader {
    public static void download(List<String> urls) throws Exception {
        int count = 1;
        for (String url : urls) {
            FileUtils.copyURLToFile(new URL(url), new File("images/image" + (count++) + ".jpg"));
        }
    }
}
