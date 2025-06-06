export default function Banner(){
   const BrandingSVG = ({ width = 200, height = 200, color }: any) => {
        return (
            <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
                width={width} height={height} viewBox="0 0 198.000000 155.000000"
                preserveAspectRatio="xMidYMid meet"
                className="mx-auto mb-4 lg:mb-0"

            >
                <g transform="translate(0.000000,155.000000) scale(0.100000,-0.100000)"
                    fill={color} stroke="none">
                    <path d="M474 919 c-209 -304 -383 -558 -387 -566 -7 -11 19 -13 154 -11 l162
3 204 315 c232 359 239 370 256 370 7 0 57 -67 112 -150 55 -82 102 -149 105
-149 7 0 142 192 154 218 7 17 2 32 -27 74 -79 112 -333 441 -343 444 -7 2
-182 -244 -390 -548z"/>
                    <path d="M1477 988 c-51 -79 -151 -233 -222 -343 -71 -110 -134 -203 -139
-207 -17 -11 -38 15 -136 162 -92 138 -93 139 -109 117 -80 -105 -141 -199
-141 -216 0 -26 355 -501 374 -501 12 0 131 171 724 1038 l63 92 -161 0 -160
0 -93 -142z"/>
                </g>
            </svg>
        )
    };
  return(
    <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
                        <div className="absolute inset-0 bg-[#D03B45]" />
                        <div className="relative z-20 flex flex-col items-center">
                            <BrandingSVG color="#FFFFFF" />
                        </div>
                        <div className="relative z-20 mt-auto font-bold">
                            <blockquote className="space-y-2">
                                <p className="text-lg">
                                    &ldquo;STRATOS INFRA TECHNOLOGIES PRIVATE LIMITED&rdquo;
                                </p>
                                <footer className="text-sm">Bangalore, KA</footer>
                            </blockquote>
                        </div>
                    </div>
                    
  )
}

 {/* <div className="bg-red-500 relative hidden lg:block">
                          </div> */}
                          {/* <div className="bg-muted relative hidden lg:block">
                            <img
                              src="/placeholder.svg"
                              alt="Image"
                              className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
                            />
                          </div> */} 