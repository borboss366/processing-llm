TARGET    := projectm-syphon
SRC       := main.mm

BREW      := /opt/homebrew
ARCH      := -arch arm64

CXX       := clang++
CXXFLAGS  := $(ARCH) -std=c++17 -O2 -fobjc-arc -Wall \
             -DGL_SILENCE_DEPRECATION \
             -F. \
             -I$(BREW)/include -I$(BREW)/include/SDL2
LDFLAGS   := $(ARCH) \
             -F. \
             -framework Syphon -framework OpenGL -framework Foundation -framework Cocoa -framework IOSurface \
             -L$(BREW)/lib -lSDL2 \
             -Wl,-rpath,@executable_path

$(TARGET): $(SRC) Syphon.framework
	$(CXX) $(CXXFLAGS) -o $@ $(SRC) $(LDFLAGS)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)

.PHONY: run clean
