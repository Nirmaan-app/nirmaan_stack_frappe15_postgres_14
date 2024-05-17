import { useState } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
//import { FullPageLoader } from "@/components/layout/Loaders";
import { Box, Flex, IconButton, Link as LinkButton } from "@radix-ui/themes";

import { FrappeError, useFrappeAuth } from "frappe-react-sdk";
import { Loader } from "@/components/common/loader";
import { ErrorText, Label } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { LoginInputs } from "@/types/Auth/Login";
import { ErrorBanner } from "@/components/layout/alert-banner/error-banner";
import { Input } from "@/components/ui/input";

import logo from "@/assets/logo-svg.svg"


export const Component = () => {
    const [error, setError] = useState<FrappeError | null>(null)

    const { login } = useFrappeAuth()

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInputs>()
    const [isPasswordOpen, setIsPasswordOpen] = useState<boolean>(false)

    const onClickReveal = () => {
        setIsPasswordOpen(!isPasswordOpen)
    }

    async function onSubmit(values: LoginInputs) {
        setError(null)
        return login({ username: values.email, password: values.password }).then(() => {
            //Reload the page so that the boot info is fetched again
            const URL = import.meta.env.VITE_BASE_NAME ? `/${import.meta.env.VITE_BASE_NAME}` : ``
            window.location.replace(`${URL}/`)
        }).catch((error) => { setError(error) })
    }

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
    const IndiaSVG = () => {
        return(
            <svg
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:cc="http://creativecommons.org/ns#"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   width="210mm"
   height="297mm"
   viewBox="0 0 210 297"
   version="1.1"
   id="svg5"
   inkscape:version="0.92.3 (2405546, 2018-03-11)"
   sodipodi:docname="india.svg">
  <defs
     id="defs2" />
  <sodipodi:namedview
     id="base"
     pagecolor="#ffffff"
     bordercolor="#666666"
     borderopacity="1.0"
     inkscape:pageopacity="0.0"
     inkscape:pageshadow="2"
     inkscape:zoom="0.35"
     inkscape:cx="200"
     inkscape:cy="560"
     inkscape:document-units="mm"
     inkscape:current-layer="layer1"
     showgrid="false"
     inkscape:window-width="1920"
     inkscape:window-height="1013"
     inkscape:window-x="-8"
     inkscape:window-y="-8"
     inkscape:window-maximized="1" />
  <metadata
     id="metadata8">
    <rdf:RDF>
      <cc:Work
         rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type
           rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
        <dc:title></dc:title>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g
     inkscape:label="Layer 1"
     inkscape:groupmode="layer"
     id="layer1"
     transform="translate(0,-757.36218)">
    <path
       style="fill:none;stroke:#000000;stroke-width:1px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1"
       d="M 33.524322,785.45255 C 42.212302,788.31689 50.900282,791.18123 59.588261,794.04557"
       id="path10" />
    <!-- More path data needed here to complete the map outline -->
  </g>
</svg>
        )
    }
    return (
        <>
            {error && <ErrorBanner error={error} />}
            <div className="container relative h-screen flex flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
                <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
                    <div className="absolute inset-0 bg-[#D03B45]" />
                    <div className="relative z-20 flex flex-col items-center">
                        <BrandingSVG color="#FFFFFF" />
                    </div>
                    <div className="relative z-20 mt-auto">
                        <blockquote className="space-y-2">
                            <p className="text-lg">
                                &ldquo;This library has saved me countless hours of work and
                                helped me deliver stunning designs to my clients faster than
                                ever before.&rdquo;
                            </p>
                            <footer className="text-sm">Sofia Davis</footer>
                        </blockquote>
                    </div>
                </div>
                <div className="lg:p-8 w-full">
                    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                        <div className="flex flex-col space-y-2 text-center">
                            {window.innerWidth < 768 && <BrandingSVG color="#D03B45" width={50} height={50} />}
                            <h1 className="text-2xl font-semibold tracking-tight">
                                Login
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Login to get started
                            </p>
                        </div>
                        <Box>
                            <form onSubmit={handleSubmit(onSubmit)}>
                                <Flex direction='column' gap='6'>
                                    <Flex direction='column' gap='4'>

                                        <Flex direction='column' gap='2'>
                                            <Label htmlFor='email' isRequired>Email</Label>
                                            <Input {...register("email",
                                                {
                                                    required: "Email is required."
                                                })}
                                                name="email"
                                                type="text"
                                                required
                                                placeholder="jane@example.com"
                                                tabIndex={0} />
                                            {errors?.email && <ErrorText>{errors?.email.message}</ErrorText>}
                                        </Flex>

                                        <Flex direction='column' gap='2'>
                                            <Label htmlFor='password' isRequired>Password</Label>
                                            <Input
                                                {...register("password",
                                                    {
                                                        required: "Password is required.",
                                                    })}
                                                name="password"
                                                type={isPasswordOpen ? "text" : "password"}
                                                autoComplete="current-password"
                                                required
                                                placeholder="***********" />
                                            <IconButton
                                                type='button'
                                                size='1'
                                                variant='ghost'
                                                aria-label={isPasswordOpen ? "Mask password" : "Reveal password"}
                                                onClick={onClickReveal}
                                                tabIndex={-1}>
                                                {isPasswordOpen ? <Eye /> : <EyeOff />}
                                            </IconButton>
                                            {errors?.password && <ErrorText>{errors.password?.message}</ErrorText>}
                                        </Flex>

                                        <Flex direction='column' gap='2' >
                                            <Button type='submit' disabled={isSubmitting} >
                                                {isSubmitting ? <Loader /> : 'Login'}
                                            </Button>
                                        </Flex>
                                        <Flex direction='column' gap='2' align="end">
                                            <LinkButton
                                                asChild
                                                size="2"
                                            >
                                                <Link to="/forgot-password">
                                                    Forgot Password?
                                                </Link>
                                            </LinkButton>
                                        </Flex>
                                    </Flex>
                                </Flex>
                            </form>
                        </Box>
                    </div>
                </div>
            </div>



            {/* </AuthContainer> */}
        </>
    )
}

Component.displayName = "LoginPage";