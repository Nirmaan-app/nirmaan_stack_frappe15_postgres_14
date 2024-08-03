/**
 * v0 by Vercel.
 * @see https://v0.dev/t/1ADs2FRNaQg
 * Documentation: https://v0.dev/docs#integrating-generated-code-into-your-nextjs-app
 */

import { useState, useContext } from "react";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { UserContext } from "@/utils/auth/UserProvider";
import { Box, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { FrappeError } from "frappe-react-sdk";
import { ErrorText, Label } from "@/components/common/form";
import { Button, buttonVariants } from "@/components/ui/button";
import logo from "@/assets/logo-svg.svg"

import { CardTitle, CardDescription, CardHeader, CardContent, Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { LoginInputs } from "@/types/Auth/Login";




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
      <div className="w-full h-auto mt-[20%]">
        {isLoading ? <h1>Loading Loginnnnnnnnnn...</h1> :

          <Card className="mx-auto max-w-sm">
            <img src={logo} alt="Nirmaan" className="h-[50px] w-[300px] pl-[40px] md:pl-[80px] pt-2" />
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
