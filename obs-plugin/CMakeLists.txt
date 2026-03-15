cmake_minimum_required(VERSION 3.16...3.28)

project(openclip-obs VERSION 1.0.0 LANGUAGES C)

# ── Generate import libraries from .def files (Windows/MSVC only) ─────────────
# We ship minimal .def files that list only the OBS exports we use, and
# generate .lib import libraries from them so we can link without the full
# OBS SDK.  On non-Windows/non-MSVC toolchains the import-lib generation is
# skipped entirely — on those platforms the plugin should be linked against
# the system-installed libobs / obs-frontend-api via pkg-config or
# find_package instead.

if(WIN32 AND MSVC)
  set(OBS_DEF_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
  set(OBS_LIB_DIR "${CMAKE_CURRENT_BINARY_DIR}/implibs")
  file(MAKE_DIRECTORY "${OBS_LIB_DIR}")

  # Use lib.exe (from the MSVC toolchain) to create import .lib from .def
  # Derive lib.exe path from the C compiler path (same directory as cl.exe)
  get_filename_component(_MSVC_BIN_DIR "${CMAKE_C_COMPILER}" DIRECTORY)
  find_program(LIB_EXE lib PATHS "${_MSVC_BIN_DIR}" NO_DEFAULT_PATH)
  if(NOT LIB_EXE)
    # Fallback: try CMAKE_AR
    set(LIB_EXE "${CMAKE_AR}")
  endif()
  if(NOT LIB_EXE)
    message(FATAL_ERROR "Could not find lib.exe — make sure MSVC tools are available")
  endif()

  # Derive the machine architecture flag for lib.exe from the generator/system info
  if(CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64" OR CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|ARM64")
    set(MACHINE_FLAG "/machine:arm64")
  elseif(CMAKE_GENERATOR_PLATFORM STREQUAL "Win32" OR CMAKE_SYSTEM_PROCESSOR MATCHES "x86$|i[3-6]86")
    set(MACHINE_FLAG "/machine:x86")
  else()
    set(MACHINE_FLAG "/machine:x64")
  endif()

  # obs.lib
  add_custom_command(
    OUTPUT "${OBS_LIB_DIR}/obs.lib"
    COMMAND "${LIB_EXE}" /def:"${OBS_DEF_DIR}/obs.def" /out:"${OBS_LIB_DIR}/obs.lib" "${MACHINE_FLAG}"
    DEPENDS "${OBS_DEF_DIR}/obs.def"
    COMMENT "Generating obs.lib from obs.def"
  )

  # obs-frontend-api.lib
  add_custom_command(
    OUTPUT "${OBS_LIB_DIR}/obs-frontend-api.lib"
    COMMAND "${LIB_EXE}" /def:"${OBS_DEF_DIR}/obs-frontend-api.def" /out:"${OBS_LIB_DIR}/obs-frontend-api.lib" "${MACHINE_FLAG}"
    DEPENDS "${OBS_DEF_DIR}/obs-frontend-api.def"
    COMMENT "Generating obs-frontend-api.lib from obs-frontend-api.def"
  )

  add_custom_target(obs_import_libs
    DEPENDS "${OBS_LIB_DIR}/obs.lib" "${OBS_LIB_DIR}/obs-frontend-api.lib"
  )
else()
  # On non-Windows or non-MSVC toolchains, skip generating MSVC import libs.
  # Provide a no-op target so other parts of the build can still depend on it.
  add_custom_target(obs_import_libs)
endif()

# ── cJSON (lightweight JSON library) ──────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(cjson
  GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git
  GIT_TAG        v1.7.18
)
set(CJSON_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CJSON_OVERRIDE_BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(ENABLE_CJSON_TEST OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(cjson)

# ── Plugin target ─────────────────────────────────────────────────────────────
add_library(openclip-obs MODULE
  src/plugin-main.c
  src/http-server.c
  src/api-handlers.c
  src/api-utils.c
  src/recording-handlers.c
  src/scene-handlers.c
  src/source-handlers.c
  src/audio-handlers.c
  src/video-handlers.c
)

add_dependencies(openclip-obs obs_import_libs)

target_include_directories(openclip-obs PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${cjson_SOURCE_DIR}
)

if(WIN32 AND MSVC)
  # Link the generated import libs and delay-load the OBS DLLs so they can
  # live in the OBS process even when our DLL is in a different directory.
  target_link_libraries(openclip-obs PRIVATE
    "${OBS_LIB_DIR}/obs.lib"
    "${OBS_LIB_DIR}/obs-frontend-api.lib"
    cjson
    delayimp.lib
  )
  target_link_options(openclip-obs PRIVATE
    /DELAYLOAD:obs.dll
    /DELAYLOAD:obs-frontend-api.dll
  )
else()
  # On Linux/macOS, link against the system-installed libobs and
  # obs-frontend-api (installed via the OBS Studio SDK / packages).
  find_package(PkgConfig QUIET)
  if(PkgConfig_FOUND)
    pkg_check_modules(OBS QUIET libobs obs-frontend-api)
  endif()
  if(OBS_FOUND)
    target_link_libraries(openclip-obs PRIVATE ${OBS_LIBRARIES} cjson)
    target_include_directories(openclip-obs PRIVATE ${OBS_INCLUDE_DIRS})
  else()
    # Fallback: expect OBS headers/libs to be on the default search path
    find_library(OBS_LIB obs REQUIRED)
    find_library(OBS_FRONTEND_LIB obs-frontend-api REQUIRED)
    target_link_libraries(openclip-obs PRIVATE ${OBS_LIB} ${OBS_FRONTEND_LIB} cjson)
  endif()
endif()

target_compile_definitions(openclip-obs PRIVATE
  OPENCLIP_OBS_VERSION="${PROJECT_VERSION}"
  _CRT_SECURE_NO_WARNINGS
)

# Winsock on Windows
if(WIN32)
  target_link_libraries(openclip-obs PRIVATE ws2_32)
endif()

# No "lib" prefix on any platform
set_target_properties(openclip-obs PROPERTIES PREFIX "")

# ── Install ───────────────────────────────────────────────────────────────────
install(TARGETS openclip-obs LIBRARY DESTINATION "openclip/bin/64bit")
