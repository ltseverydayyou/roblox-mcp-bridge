#include <jni.h>
#include <node.h>
#include <android/log.h>

#include <string>
#include <vector>

extern "C" JNIEXPORT jint JNICALL
Java_com_ltseverydayyou_robloxmcpmanager_NativeNode_start(
    JNIEnv* env, jclass, jobjectArray java_arguments) {
  const jsize count = env->GetArrayLength(java_arguments);
  std::vector<std::string> storage;
  storage.reserve(count);

  for (jsize index = 0; index < count; ++index) {
    auto value = static_cast<jstring>(env->GetObjectArrayElement(java_arguments, index));
    const char* utf = env->GetStringUTFChars(value, nullptr);
    storage.emplace_back(utf == nullptr ? "" : utf);
    if (utf != nullptr) env->ReleaseStringUTFChars(value, utf);
    env->DeleteLocalRef(value);
  }

  std::vector<char*> arguments;
  arguments.reserve(storage.size());
  for (auto& value : storage) arguments.push_back(value.data());

  __android_log_print(ANDROID_LOG_INFO, "RobloxMcpNode", "Starting embedded Node.js");
  return node::Start(static_cast<int>(arguments.size()), arguments.data());
}
