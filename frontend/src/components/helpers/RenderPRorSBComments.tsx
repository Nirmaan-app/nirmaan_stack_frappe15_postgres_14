import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments"
import { formatDate } from "@/utils/FormatDate"
import React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"

interface RenderPRorSBCommentsProps {
  universalComment? :  NirmaanComments[]
  getUserName: (id : string | undefined) => string
}
export const RenderPRorSBComments : React.FC<RenderPRorSBCommentsProps> = ({universalComment, getUserName}) => {
    return (
      <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2 mb-2">
      {universalComment?.length !== 0 ? (
          universalComment?.map((comment) => (
              <div key={comment?.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                  <Avatar>
                      <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment?.comment_by}`} />
                      <AvatarFallback>{comment?.comment_by?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                      <p className="font-medium text-sm text-gray-900">{comment?.content}</p>
                      <div className="flex justify-between items-center mt-2">
                          <p className="text-sm text-gray-500">
                              {comment?.comment_by === "Administrator" ? "Administrator" : getUserName(comment?.comment_by)}
                          </p>
                          <p className="text-xs text-gray-400">
                              {formatDate(comment?.creation?.split(" ")[0])} {comment?.creation?.split(" ")[1].substring(0, 5)}
                          </p>
                      </div>
                  </div>
              </div>
          ))
      ) : (
          <span className="text-xs font-semibold">No Comments Found</span>
      )}
  </div>
    )
  }