import type { Preview } from "@storybook/react-vite";
import { ReviewApiProvider } from "../src/review-api.tsx";
import { fakeReviewApi } from "../src/stories/fixtures.ts";
import "./preview.css";

const preview: Preview = {
  // Components that load data (ChapterReview, FileDiffCard) read a ReviewApi
  // from context; stories get an in-memory one, never the network.
  decorators: [
    (Story) => (
      <ReviewApiProvider api={fakeReviewApi()}>
        <Story />
      </ReviewApiProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
