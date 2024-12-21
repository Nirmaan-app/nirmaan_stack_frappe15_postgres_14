import { useForm } from "react-hook-form";
import { Card, CardTitle, CardDescription, CardContent, CardHeader } from "@/components/ui/card";
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

export default function ForgotPassword() {

  const [loadingState, setLoadingState] = useState(false)

  const {currentUser} = useContext(UserContext)

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

  if(!currentUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center px-4">
        <Card className="mx-auto max-w-sm">
        <CardDescription className="flex items-center gap-1 my-4 pl-2 pb-0">
                  <ArrowLeft className="cursor-pointer hover:text-black" onClick={() => navigate("/login")} />
                  Go Back
              </CardDescription>
          <CardHeader className="space-y-1 pt-0">
            <CardTitle className="text-2xl font-bold">Forgot Password</CardTitle>
            <CardDescription>Enter your User ID to reset the password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="userId" isRequired>User ID</Label>
                <Input
                  {...register("userId", { required: "User ID is required." })}
                  name="userId"
                  type="text"
                  placeholder="Enter your User ID"
                />
                {errors?.userId && <ErrorText>{errors.userId.message}</ErrorText>}
              </div>
              <Button
                className="w-full"
                type="submit"
                disabled={loadingState}
              >
                  {loadingState ? <TailSpin height={20} width={20} color="white" /> : "Reset Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }
  else return <Navigate to="/" />
}
