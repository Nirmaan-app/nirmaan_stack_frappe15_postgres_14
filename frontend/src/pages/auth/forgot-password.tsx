import { useForm } from "react-hook-form";

import logo from "@/assets/logo-svg.svg";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/common/form";
import { ErrorText } from "@/components/common/form";
import { useContext, useState } from "react";
import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { ArrowBigLeft, ArrowLeft } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { UserContext } from "@/utils/auth/UserProvider";
import Banner from "./components/banner";
import { cn } from "@/lib/utils"

export default function ForgotPassword() {

  const [loadingState, setLoadingState] = useState(false)

  const { currentUser } = useContext(UserContext)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ userId: string }>();

  const { call } = useContext(FrappeContext) as FrappeConfig

  const navigate = useNavigate()

  async function onSubmit(values: { userId: string }) {
    try {
      setLoadingState(true);

      await call.post('frappe.core.doctype.user.user.reset_password', {
        user: values.userId
      })

      toast({
        title: "Success!",
        description: "Password Reset Email has been sent!",
        variant: "success"
      });

    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: `Unable to Send Email Reset Link, ${error?.message}`,
        variant: "destructive"
      });
    } finally {
      setLoadingState(false)
    }
  }





   if (!currentUser) {
        return (

            <div className=" w-full relative h-screen  grid min-h-svh lg:grid-cols-2">
                {loadingState ? (<div className='w-full h-screen flex items-center justify-center'>
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
                             <div className="flex items-center gap-1 my-6 pl-2 pb-0">
            <ArrowLeft className="cursor-pointer hover:text-black" onClick={() => navigate("/login")} />
            Go Back
          </div>
                            <form className={cn("flex flex-col gap-6")} >
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <h1 className="text-2xl font-bold">Forgot Password</h1>
                                    <p className="text-muted-foreground text-sm text-balance">
                                        Enter your User ID to reset the password
                                    </p>
                                </div>
                                <div className="grid gap-6">
                                    <div className="grid gap-3">
                                        {/* <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="m@example.com" required /> */}
                                        <Label htmlFor="email" isRequired>User ID</Label>
                                        <Input
                                            {...register("userId", { required: "User ID is required." })}
                  name="userId"
                  type="text"
                  placeholder="Enter your User ID"
                                        />
                                        {errors?.userId && <small className="text-red-500">{errors.userId.message}</small>}

                                    </div>
                                   
                                    <Button type="submit" disabled={isSubmitting} className="w-full" onClick={handleSubmit(onSubmit)}>
                                       {loadingState ? <TailSpin height={20} width={20} color="white" /> : "Reset Password"}
                                    </Button>
                                    {errors && <h3 className="text-red-500">{errors.message}</h3>}
                                  
         
                                </div>
                              
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