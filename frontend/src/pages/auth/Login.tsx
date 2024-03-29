import { useState, useContext } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { UserContext } from "@/utils/auth/UserProvider";
//import { FullPageLoader } from "@/components/layout/Loaders";
import { Box, Flex, IconButton, Text, TextField } from "@radix-ui/themes";

import { FrappeError } from "frappe-react-sdk";
//import { Loader } from "@/components/common/Loader";
import { ErrorText, Label } from "@/components/common/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
//import { ErrorCallout } from "@/components/layout/AlertBanner/ErrorBanner";

type Inputs = {
    email: string;
    password: string;
};

export const Component = () => {
    const [error, setError] = useState<FrappeError | null>(null)
    const { currentUser, login, isLoading } = useContext(UserContext)
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Inputs>()
    const [isOpen, setIsOpen] = useState(false)

    const onClickReveal = () => {
        setIsOpen(!isOpen)
    }

    async function onSubmit(values: Inputs) {
        setError(null)
        return login(values.email, values.password)
            .catch((error) => { setError(error) })
    }
    if (!currentUser) {
        return (
            //             <>
            //                 <div className="md:hidden">
            //                     <img
            //                         src="/examples/authentication-light.png"
            //                         width={1280}
            //                         height={843}
            //                         alt="Authentication"
            //                         className="block dark:hidden"
            //                     />
            //                     <img
            //                         src="/examples/authentication-dark.png"
            //                         width={1280}
            //                         height={843}
            //                         alt="Authentication"
            //                         className="hidden dark:block"
            //                     />
            //                 </div>
            //                 <div className="container relative hidden h-[800px] flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            //                     <Link
            //                         to="/login"
            //                         className={cn(
            //                             buttonVariants({ variant: "ghost" }),
            //                             "absolute right-4 top-4 md:right-8 md:top-8"
            //                         )}
            //                     >
            //                         Login
            //                     </Link>
            //                 </div><div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
            //                     <div className="absolute inset-0 bg-zinc-900" />
            //                     <div className="relative z-20 flex items-center text-lg font-medium">
            //                         <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
            //                             width="198.000000pt" height="155.000000pt" viewBox="0 0 198.000000 155.000000"
            //                             preserveAspectRatio="xMidYMid meet">

            //                             <g transform="translate(0.000000,155.000000) scale(0.100000,-0.100000)"
            //                                 fill="#000000" stroke="none">
            //                                 <path d="M474 919 c-209 -304 -383 -558 -387 -566 -7 -11 19 -13 154 -11 l162
            // 3 204 315 c232 359 239 370 256 370 7 0 57 -67 112 -150 55 -82 102 -149 105
            // -149 7 0 142 192 154 218 7 17 2 32 -27 74 -79 112 -333 441 -343 444 -7 2
            // -182 -244 -390 -548z"/>
            //                                 <path d="M1477 988 c-51 -79 -151 -233 -222 -343 -71 -110 -134 -203 -139
            // -207 -17 -11 -38 15 -136 162 -92 138 -93 139 -109 117 -80 -105 -141 -199
            // -141 -216 0 -26 355 -501 374 -501 12 0 131 171 724 1038 l63 92 -161 0 -160
            // 0 -93 -142z"/>
            //                             </g>
            //                         </svg>
            //                         Nirmaan
            //                     </div>
            //                     <div className="relative z-20 mt-auto">
            //                         <blockquote className="space-y-2">
            //                             <p className="text-lg">
            //                                 &ldquo;Changes come from within&rdquo;
            //                             </p>
            //                             <footer className="text-sm">AK</footer>
            //                         </blockquote>
            //                     </div>
            //                     <div className="lg:p-8">
            //                         <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
            //                             <div className="flex flex-col space-y-2 text-center">
            //                                 <h1 className="text-2xl font-semibold tracking-tight">
            //                                     Create an account
            //                                 </h1>
            //                                 <p className="text-sm text-muted-foreground">
            //                                     Enter your email below to create your account
            //                                 </p>
            //                             </div>

            //                             <p className="px-8 text-center text-sm text-muted-foreground">
            //                                 By clicking continue, you agree to our{" "}
            //                                 <Link
            //                                     to="/terms"
            //                                     className="underline underline-offset-4 hover:text-primary"
            //                                 >
            //                                     Terms of Service
            //                                 </Link>{" "}
            //                                 and{" "}
            //                                 <Link
            //                                     to="/privacy"
            //                                     className="underline underline-offset-4 hover:text-primary"
            //                                 >
            //                                     Privacy Policy
            //                                 </Link>
            //                                 .
            //                             </p>
            //                         </div>
            //                     </div>
            //                 </div>
            //             </>
            <Box className={'min-h-screen'}>
                <Flex justify='center' align='center' className={'h-screen w-full'}>
                    {isLoading ? <h1>Loading...</h1> :
                        <Box className={'w-full max-w-xl'}>
                            <Flex direction='column' gap='6' className={'w-full bg-white rounded-lg shadow dark:border dark:bg-gray-900 dark:border-gray-700 p-8'}>

                                <Link to="/" tabIndex={-1}>
                                    <Flex justify="center">
                                        <Text as='span' size='9' className='cal-sans'>Login To NIRMAAN</Text>
                                    </Flex>
                                </Link>

                                {error && <h1>{error.message}</h1>}
                                <form onSubmit={handleSubmit(onSubmit)}>
                                    <Flex direction='column' gap='6'>
                                        <Flex direction='column' gap='4'>

                                            <Flex direction='column' gap='2'>
                                                <Label htmlFor='email' isRequired>Email / Username</Label>
                                                <TextField.Root>
                                                    <TextField.Input {...register("email",
                                                        {
                                                            required: "Email or Username is required."
                                                        })}
                                                        name="email"
                                                        type="text"
                                                        required
                                                        placeholder="jane@example.com"
                                                        tabIndex={0} />
                                                </TextField.Root>
                                                {errors?.email && <ErrorText>{errors?.email?.message}</ErrorText>}
                                            </Flex>

                                            <Flex direction='column' gap='2'>
                                                <Label htmlFor='password' isRequired>Password</Label>
                                                <TextField.Root>
                                                    <TextField.Input
                                                        {...register("password",
                                                            {
                                                                required: "Password is required.",
                                                                minLength: { value: 6, message: "Password should be minimum 6 characters." }
                                                            })}
                                                        name="password"
                                                        type={isOpen ? "text" : "password"}
                                                        autoComplete="current-password"
                                                        required
                                                        placeholder="***********" />
                                                    <TextField.Slot>
                                                        <IconButton
                                                            type='button'
                                                            size='1'
                                                            variant='ghost'
                                                            aria-label={isOpen ? "Mask password" : "Reveal password"}
                                                            onClick={onClickReveal}
                                                            tabIndex={-1}>
                                                            {isOpen ? <Eye /> : <EyeOff />}
                                                        </IconButton>
                                                    </TextField.Slot>
                                                </TextField.Root>
                                                {errors?.password && <ErrorText>{errors.password?.message}</ErrorText>}
                                            </Flex>
                                        </Flex>

                                        <Button type='submit' disabled={isSubmitting}>
                                            {isSubmitting ? <h1>Loading...</h1> : 'Login'}
                                        </Button>
                                    </Flex>
                                </form>
                            </Flex>
                        </Box>
                    }
                </Flex>
            </Box>

        )
    }
    else return <Navigate to="/" />
}

Component.displayName = "LoginPage";