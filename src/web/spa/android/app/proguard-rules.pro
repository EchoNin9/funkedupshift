# Add project specific ProGuard rules here.

# Preserve line numbers in stack traces so Play Console crash reports are readable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep Capacitor plugin classes and their @PluginMethod annotations intact.
# (Capacitor's AAR already ships consumer rules, but this guards against
#  any gap with the bridge's JavaScript↔Java reflection calls.)
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod *;
}
