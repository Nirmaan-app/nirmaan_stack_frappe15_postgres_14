import { ReactNode } from "react";
import { TailSpin } from "react-loader-spinner";
import logo from "@/assets/logo-svg.svg";
import { Link } from "react-router-dom";

interface AuthLayoutProps {
  children: ReactNode;
  isLoading?: boolean;
  showBanner?: boolean;
}

/**
 * Shared layout wrapper for authentication pages.
 * Provides consistent two-column layout with loading state handling.
 */
export function AuthLayout({
  children,
  isLoading = false,
  showBanner = true
}: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen w-full grid lg:grid-cols-2">
      {/* Left Side - Form Area */}
      <div className="flex flex-col min-h-screen">
        {/* Logo Header */}
        <header className="p-6 md:p-8 lg:p-10">
          <Link
            to="/"
            className="inline-flex items-center transition-opacity hover:opacity-80"
          >
            <img
              src={logo}
              alt="Nirmaan"
              className="h-10 md:h-12 w-auto"
            />
          </Link>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex items-center justify-center px-6 pb-12 md:px-8 lg:px-10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4">
              <TailSpin
                visible={true}
                height="56"
                width="56"
                color="hsl(var(--primary))"
                ariaLabel="Loading authentication"
              />
              <p className="text-sm text-muted-foreground animate-pulse">
                Initializing...
              </p>
            </div>
          ) : (
            <div className="w-full max-w-sm">
              {children}
            </div>
          )}
        </main>

        {/* Footer - Mobile Brand */}
        <footer className="p-6 text-center lg:hidden">
          <p className="text-xs text-muted-foreground">
            Stratos Infra Technologies Pvt. Ltd.
          </p>
        </footer>
      </div>

      {/* Right Side - Banner (Desktop Only) */}
      {showBanner && <AuthBanner />}
    </div>
  );
}

/**
 * Branded banner panel for desktop view.
 * Features animated gradient background with company branding.
 */
function AuthBanner() {
  return (
    <div className="relative hidden lg:flex flex-col bg-primary overflow-hidden">
      {/* Gradient Overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: `
            radial-gradient(circle at 20% 80%, rgba(255,255,255,0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(0,0,0,0.1) 0%, transparent 50%)
          `
        }}
      />

      {/* Subtle Pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-10 lg:p-12 xl:p-16">
        {/* Logo Mark */}
        <div className="flex-1 flex items-center justify-center">
          <BrandingMark />
        </div>

        {/* Company Info */}
        <div className="text-white">
          <blockquote className="space-y-2">
            <p className="text-lg xl:text-xl font-semibold tracking-tight">
              "Building Tomorrow's Infrastructure Today"
            </p>
            <footer className="text-sm text-white/80 font-medium">
              Stratos Infra Technologies Pvt. Ltd.
              <span className="block text-white/60 text-xs mt-1">
                Bangalore, Karnataka
              </span>
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}

/**
 * Animated branding mark SVG for the banner.
 */
function BrandingMark() {
  return (
    <svg
      version="1.0"
      xmlns="http://www.w3.org/2000/svg"
      width="180"
      height="140"
      viewBox="0 0 198 155"
      preserveAspectRatio="xMidYMid meet"
      className="drop-shadow-lg"
      aria-hidden="true"
    >
      <g
        transform="translate(0,155) scale(0.1,-0.1)"
        fill="white"
        stroke="none"
        className="animate-[fadeIn_0.8s_ease-out]"
      >
        <path d="M474 919 c-209 -304 -383 -558 -387 -566 -7 -11 19 -13 154 -11 l162
          3 204 315 c232 359 239 370 256 370 7 0 57 -67 112 -150 55 -82 102 -149 105
          -149 7 0 142 192 154 218 7 17 2 32 -27 74 -79 112 -333 441 -343 444 -7 2
          -182 -244 -390 -548z"
        />
        <path d="M1477 988 c-51 -79 -151 -233 -222 -343 -71 -110 -134 -203 -139
          -207 -17 -11 -38 15 -136 162 -92 138 -93 139 -109 117 -80 -105 -141 -199
          -141 -216 0 -26 355 -501 374 -501 12 0 131 171 724 1038 l63 92 -161 0 -160
          0 -93 -142z"
        />
      </g>
    </svg>
  );
}

export default AuthLayout;
