cmake_minimum_required(VERSION 3.22.1)
project(roblox_mcp_node_launcher)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so")

add_library(native-node SHARED native-node.cpp)
target_include_directories(native-node PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/node-include")
target_link_libraries(native-node node log android)
