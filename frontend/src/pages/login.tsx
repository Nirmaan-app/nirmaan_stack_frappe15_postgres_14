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

import { CardTitle, CardDescription, CardHeader, CardContent, Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"


type Inputs = {
  email: string;
  password: string;
};

export default function Login() {

  const [error, setError] = useState<FrappeError | null>(null)
  const { currentUser, login, isLoading } = useContext(UserContext)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Inputs>()

  async function onSubmit(values: Inputs) {
      setError(null)
      return login(values.email, values.password)
          .catch((error) => { setError(error) })
  }
  if(!currentUser){
    return (
      <div className="mt-10">
      {isLoading ? <h1>Loading...</h1> :
      // {error && <h1>{error.message}</h1>}

      <Card className="mx-auto max-w-sm">
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
                  minLength: { value: 6, message: "Password should be minimum 6 characters." }
              })}
              name="password" 
              autoComplete="current-password"
              type="password"
              placeholder="***********" />
            </div>
            {errors?.password && <ErrorText>{errors.password?.message}</ErrorText>}
            <Button className="w-full" type="submit" onClick={handleSubmit(onSubmit)}>
              Login
            </Button>
          </div>
        </CardContent>
      </Card>
    }
    </div>
    )
  }
  else return <Navigate to="/" />
}

