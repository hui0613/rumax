cmake_minimum_required(VERSION 3.16)
project(rumax_cpp_demo CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 指向 cargo 产物目录（默认 target/release，可用 -DRUMAX_LIB_DIR=... 覆盖）
set(RUMAX_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../target/release"
    CACHE PATH "Directory containing librumax.so / .a")
set(RUMAX_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../include"
    CACHE PATH "Directory containing rumax.h")

add_executable(cpp_demo main.cpp)
target_include_directories(cpp_demo PRIVATE "${RUMAX_INCLUDE_DIR}")

# 优先链接动态库
find_library(RUMAX_SHARED NAMES rumax PATHS "${RUMAX_LIB_DIR}" NO_DEFAULT_PATH)
find_library(RUMAX_STATIC NAMES "rumax" PATHS "${RUMAX_LIB_DIR}" NO_DEFAULT_PATH)

if(RUMAX_SHARED)
    target_link_libraries(cpp_demo PRIVATE "${RUMAX_SHARED}")
    set_target_properties(cpp_demo PROPERTIES BUILD_RPATH "${RUMAX_LIB_DIR}")
elseif(RUMAX_STATIC)
    target_link_libraries(cpp_demo PRIVATE "${RUMAX_STATIC}")
else()
    message(FATAL_ERROR "rumax library not found in ${RUMAX_LIB_DIR}. Run `cargo build --release` first.")
endif()
