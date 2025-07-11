export interface IUserResponse {
    token: string;
    user:{
      role: string;
      email: string;
      userName: string;
      name: string;
      profileImage: string;
      isVerified: boolean;
      userId: string;
    };
    isNewUser: boolean;
  }
