import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Comment } from "../types";
import { queryKeys, getCommentListOptions } from "@/config/queryKeys"; // Adjust path

interface UsePRCommentsProps {
    prName?: string;
}

export const usePRComments = ({ prName }: UsePRCommentsProps) => {
    const options = getCommentListOptions(prName);
    const queryKey = queryKeys.comments.list(options);
    const enabled = !!prName;

    return useFrappeGetDocList<Comment>(
        "Nirmaan Comments",
        options as GetDocListArgs<FrappeDoc<Comment>>,
        enabled ? JSON.stringify(queryKey) : null
        // {
        //     queryKey,
        //     enabled
        // }
    );
};