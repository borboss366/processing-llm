// Phase A — Syphon smoke test.
// Opens an SDL2 GL window, renders an animated gradient, and publishes it to
// Syphon. Verifies the Processing receiver picks it up before we introduce
// projectM. Replace the rendering block with libprojectM in Phase B.

#import <Foundation/Foundation.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>
#import <Syphon/Syphon.h>

#include <SDL2/SDL.h>
#include <math.h>
#include <stdio.h>

static const int WIDTH  = 800;
static const int HEIGHT = 600;

// Renders an animated diagonal gradient. Used twice per frame — once to the
// SDL window for visual confirmation, once into the Syphon FBO for publishing.
static void drawGradient(float t) {
    glViewport(0, 0, WIDTH, HEIGHT);
    glClearColor(0.04f, 0.04f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    glMatrixMode(GL_PROJECTION); glLoadIdentity();
    glOrtho(0, 1, 0, 1, -1, 1);
    glMatrixMode(GL_MODELVIEW);  glLoadIdentity();

    const float r = (sinf(t)            + 1.0f) * 0.5f;
    const float g = (sinf(t * 1.3f + 1) + 1.0f) * 0.5f;
    const float b = (sinf(t * 0.7f + 2) + 1.0f) * 0.5f;

    glBegin(GL_QUADS);
        glColor3f(0, 0, 0); glVertex2f(0, 0);
        glColor3f(r, 0, b); glVertex2f(1, 0);
        glColor3f(r, g, b); glVertex2f(1, 1);
        glColor3f(0, g, 0); glVertex2f(0, 1);
    glEnd();
}

int main(int argc, char** argv) { @autoreleasepool {
    const char* serverName = (argc > 1) ? argv[1] : "Main";
    const char* appName    = (argc > 2) ? argv[2] : "projectM";

    // Set process name so Syphon publishes us under "projectM" (matches modules/projectm/module.json)
    [[NSProcessInfo processInfo] setProcessName:[NSString stringWithUTF8String:appName]];

    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_COMPATIBILITY);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);

    SDL_Window* win = SDL_CreateWindow("projectm-syphon (Phase A test pattern)",
        SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED,
        WIDTH, HEIGHT, SDL_WINDOW_OPENGL);
    if (!win) { fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError()); return 1; }

    SDL_GLContext glctx = SDL_GL_CreateContext(win);
    if (!glctx) { fprintf(stderr, "SDL_GL_CreateContext: %s\n", SDL_GetError()); return 1; }
    SDL_GL_MakeCurrent(win, glctx);
    SDL_GL_SetSwapInterval(1);

    CGLContextObj cgl = CGLGetCurrentContext();
    if (!cgl) { fprintf(stderr, "CGLGetCurrentContext returned NULL\n"); return 1; }

    SyphonOpenGLServer* server = [[SyphonOpenGLServer alloc]
        initWithName:[NSString stringWithUTF8String:serverName]
             context:cgl
             options:nil];
    if (!server) { fprintf(stderr, "SyphonOpenGLServer init failed\n"); return 1; }

    fprintf(stderr, "[publisher] Syphon server up — app=\"%s\" name=\"%s\" — press ESC or close window to quit\n", appName, serverName);

    bool running = true;
    Uint32 start = SDL_GetTicks();

    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_QUIT) running = false;
            if (e.type == SDL_KEYDOWN && e.key.keysym.sym == SDLK_ESCAPE) running = false;
        }
        const float t = (SDL_GetTicks() - start) / 1000.0f;

        // 1) Draw to the window so we can see what we're publishing
        drawGradient(t);
        SDL_GL_SwapWindow(win);

        // 2) Publish the same frame to Syphon
        if ([server bindToDrawFrameOfSize:NSMakeSize(WIDTH, HEIGHT)]) {
            drawGradient(t);
            [server unbindAndPublish];
        }
    }

    [server stop];
    SDL_GL_DeleteContext(glctx);
    SDL_DestroyWindow(win);
    SDL_Quit();
    return 0;
}}
