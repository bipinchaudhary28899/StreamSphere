export interface IUserResponse {
    token: string;
    user: {
      role: string;
      email: string;
      userName: string;
      name: string;
      profileImage: string;
      isVerified: boolean;
      userId: string;
      avatarSource: string;
      googlePicture: string;
      bannerSource: string;
      bannerImage: string;
    };
    isNewUser: boolean;
  }
