package com.ltseverydayyou.robloxmcpmanager;

final class NativeNode {
    static {
        System.loadLibrary("node");
        System.loadLibrary("native-node");
    }

    private NativeNode() {}

    static native int start(String[] arguments);
}
