import { Prompt } from "@better-giving/ui";
import { useLocation, useNavigate } from "react-router";

const SuccessPrompt = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  // closing lands on the review page, whose Back returns to the list's view
  return (
    <Prompt
      type="success"
      onClose={() =>
        navigate(
          { pathname: "..", search },
          { preventScrollReset: true, replace: true }
        )
      }
    >
      Review submitted
    </Prompt>
  );
};
export default SuccessPrompt;
