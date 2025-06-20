import { GalleryVerticalEnd } from "lucide-react"
import logo from "@/assets/logo-svg.svg";
import Banner from "./components/banner";
import { ErrorText, Label } from "@/components/common/form";
import { UserContext } from "@/utils/auth/UserProvider";
import { FrappeError } from "frappe-react-sdk";
import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate } from "react-router-dom";

import { LoginInputs } from "@/types/Auth/Login";
import { TailSpin } from "react-loader-spinner";

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function Login() {
    const [error, setError] = useState<FrappeError | null>(null)
    const { currentUser, login, isLoading } = useContext(UserContext)
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInputs>()

    async function onSubmit(values: LoginInputs) {
        setError(null)
        return login(values.email, values.password)
            .catch((error) => { setError(error) })
    }

    if (!currentUser) {
        console.log(error)
        return (

            <div className=" w-full relative h-screen  grid min-h-svh lg:grid-cols-2">
                {isLoading ? (<div className='w-full h-screen flex items-center justify-center'>
                    <TailSpin visible={true} height="100" width="100" color="#D03B45" ariaLabel="tail-spin-loading" />
                </div>) : (<div className="flex flex-col gap-4 p-6 md:p-10">
                    <div className="flex justify-center gap-2 md:justify-start">
                        <a href="#" className="flex items-center gap-2 font-medium">
                            {/* <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-4" />
            </div> */}
                            <div className="flex items-center justify-center">
                                <img src={logo} alt="Nirmaan" className="h-14 w-64 pt-2" />
                            </div>
                            {/* Acme Inc. */}
                        </a>
                    </div>
                    <div className="flex flex-1 items-center justify-center">
                        <div className="w-full max-w-xs">
                            {/* <LoginForm /> */}
                            <form className={cn("flex flex-col gap-6")} >
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <h1 className="text-2xl font-bold">Login to your account</h1>
                                    <p className="text-muted-foreground text-sm text-balance">
                                        Enter your email below to login to your account
                                    </p>
                                </div>
                                <div className="grid gap-6">
                                    <div className="grid gap-3">
                                        {/* <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="m@example.com" required /> */}
                                        <Label htmlFor="email" isRequired>Email</Label>
                                        <Input
                                            {...register("email",
                                                {
                                                    required: "Email or Username is required."
                                                })}
                                            name="email"
                                            type="text"
                                            placeholder="m@example.com"
                                            tabIndex={0}
                                            data-cy="username-login-input-email"
                                        />
                                        {errors?.email && <small className="text-red-500">{errors?.email?.message}</small>}

                                    </div>
                                    <div className="grid gap-3">
                                        <div className="flex items-center">
                                            <Label htmlFor="password" isRequired>Password</Label>
                                            {/* <Label htmlFor="password">Password</Label> */}
                                            <Link
                                                className="ml-auto text-sm hover:text-blue-600" to={"/forgot-password"}
                                            >
                                                Forgot your password?
                                            </Link>
                                        </div>
                                        <Input
                                            {...register("password",
                                                {
                                                    required: "Password is required.",
                                                    minLength: { value: 5, message: "Password should be minimum 6 characters." }
                                                })}
                                            name="password"
                                            autoComplete="current-password"
                                            type="password"
                                            placeholder="***********"
                                            data-cy="username-login-input-password" />
                                        {/* <Input id="password" type="password" required /> */}
                                    </div>
                                    {errors?.password && <small className="text-red-500">{errors?.password?.message}</small>}
                                    <Button type="submit" disabled={isSubmitting} className="w-full" onClick={handleSubmit(onSubmit)} data-cy="login-button">
                                        Login
                                    </Button>
                                    {error && <h3 className="text-red-500">{error.message}</h3>}
                                    {/* <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
          <span className="bg-background text-muted-foreground relative z-10 px-2">
            Or continue with
          </span>
        </div>
        <Button variant="outline" className="w-full">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
              fill="currentColor"
            />
          </svg>
          Login with GitHub
        </Button> */}
                                </div>
                                {/* <div className="text-center text-sm">
        Don&apos;t have an account?{" "}
        <a href="#" className="underline underline-offset-4">
          Sign up
        </a>
      </div> */}
                            </form>

                        </div>
                    </div>
                </div>)}

                <Banner />

            </div>

        )
    } else {
        return <Navigate to="/" />
    }
}

