import logo from "@/assets/logo-svg.svg";
import { ErrorText, Label } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { UserContext } from "@/utils/auth/UserProvider";
import { FrappeError } from "frappe-react-sdk";
import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoginInputs } from "@/types/Auth/Login";
import { TailSpin } from "react-loader-spinner";

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
      <div className="flex h-screen w-full items-center justify-center px-4">
        {isLoading ? (<div className='w-full h-screen flex items-center justify-center'>
                    <TailSpin visible={true} height="100" width="100" color="#D03B45" ariaLabel="tail-spin-loading" />
                </div>) :

          <Card className="mx-auto max-w-sm">
            <div className="flex items-center justify-center">
              <img src={logo} alt="Nirmaan" className="h-14 w-64 pt-2" />
            </div>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold">Login</CardTitle>
              <CardDescription>Enter your email and password to login to your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
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
                  />
                  {errors?.email && <ErrorText>{errors?.email?.message}</ErrorText>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" isRequired>Password</Label>
                  <Input
                    {...register("password",
                      {
                        required: "Password is required.",
                        minLength: { value: 5, message: "Password should be minimum 6 characters." }
                      })}
                    name="password"
                    autoComplete="current-password"
                    type="password"
                    placeholder="***********" />
                </div>

              <div className="text-end">
                <Link className="hover:text-blue-600" to={"/forgot-password"}>
                      Forgot Password?
                </Link>
                </div>
                {errors?.password && <h1>{errors.password?.message}</h1>}
                <Button className="w-full" type="submit" onClick={handleSubmit(onSubmit)}>
                  Login
                </Button>
                {error && <h3 className="text-red-500">{error.message}</h3>}
              </div>
            </CardContent>
          </Card>
        }
      </div>
    )
  }
  else return <Navigate to="/" />
}
// -------------------------------------------******************------------------------------
// import { useState, useContext } from "react"
// import { useForm } from "react-hook-form"
// import { Navigate } from "react-router-dom"
// import { UserContext } from "@/utils/auth/UserProvider"
// // import { Button, Input, ErrorText, Label } from "@/components/ui"
// import logo from "@/assets/logo-svg.svg"
// import { Card, CardTitle, CardDescription, CardContent, CardHeader } from "@/components/ui/card"
// import { LoginInputs } from "@/types/Auth/Login"

// export default function Login() {
//   const [error, setError] = useState<FrappeError | null>(null)
//   const { currentUser, login, isLoading } = useContext(UserContext)
//   const { register, handleSubmit, formState: { errors } } = useForm<LoginInputs>()

//   async function onSubmit(values: LoginInputs) {
//     setError(null)
//     try {
//       await login(values.email, values.password)
//     } catch (error : any) {
//       setError(error)
//     }
//   }

//   if (currentUser) return <Navigate to="/" />

//   return (
//     <div className="mt-10">
//       {isLoading ? <h1>Loading...</h1> :
//         <Card className="mx-auto max-w-sm">
//           <img src={logo} alt="Nirmaan" className="h-[50px] w-[300px] pl-[40px] md:pl-[80px] pt-2" />
//           <CardHeader className="space-y-1">
//             <CardTitle className="text-2xl font-bold">Login</CardTitle>
//             <CardDescription>Enter your email and password to login to your account</CardDescription>
//           </CardHeader>
//           <CardContent>
//             <div className="space-y-4">
//               <div className="space-y-2">
//                 <Label htmlFor="email" isRequired>Email</Label>
//                 <Input
//                   {...register("email", { required: "Email or Username is required." })}
//                   name="email"
//                   type="text"
//                   placeholder="m@example.com"
//                 />
//                 {errors?.email && <ErrorText>{errors?.email?.message}</ErrorText>}
//               </div>
//               <div className="space-y-2">
//                 <Label htmlFor="password" isRequired>Password</Label>
//                 <Input
//                   {...register("password", {
//                     required: "Password is required.",
//                     minLength: { value: 5, message: "Password should be at least 6 characters." }
//                   })}
//                   name="password"
//                   autoComplete="current-password"
//                   type="password"
//                   placeholder="***********"
//                 />
//                 {errors?.password && <h1>{errors.password?.message}</h1>}
//               </div>
//               <Button className="w-full" type="submit" onClick={handleSubmit(onSubmit)}>
//                 Login
//               </Button>
//               {error && <h3 className="text-red-500">{error.message}</h3>}
//             </div>
//           </CardContent>
//         </Card>
//       }
//     </div>
//   )
// }
